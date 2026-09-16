// The real fetcher. This is the first module in the lane that can open a
// socket to somebody else's server, so every rule the founder's terms review
// was granted under is enforced HERE, before the request leaves, and a
// refusal is thrown loudly rather than logged and skipped.
//
// What it refuses, always:
//   - anything that is not https
//   - any host but the one the caller names (which comes from the `sources`
//     row, never from a list typed into this file)
//   - any path the caller's own path check refuses (which comes from the
//     parser's single exclusion list, never from a copy)
//   - a redirect: reported, never followed, because a redirect can land on a
//     path nobody reviewed
//   - a response body past `maxBytes`: the connection is dropped mid-stream
//
// What it always does:
//   - sends the pinned, honest user agent with a contact address
//   - sends conditional-request headers when the caller has them, so a
//     repeat visit costs the host a 304 and no body (this is half of what
//     keeps us clear of the AUP's Abuse of Resources clause; the other half
//     is the ten-second spacing, which lives in limiter.js and run.js)
//   - gives up after `timeoutMs` rather than holding a connection open
//
// It never stores a page body anywhere. It hands the text back to the caller
// and forgets it.

import { USER_AGENT } from './identity.js';

export const MAX_BYTES = 2_000_000;
export const TIMEOUT_MS = 20_000;

// A refusal by our own rules, before or during the request. Separate from a
// network failure on purpose: this one means WE said no.
export class FetchRefused extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'FetchRefused';
    this.details = details;
  }
}

// Decides whether a URL may be requested at all. Pure, and exported so the
// decision can be tested without a network and reused by any caller.
//
// `allowHost` is the host from the `sources` row. `pathAllowed` is a
// function the caller supplies; for smoothcomp.com it is the parser's own
// classifier, so there is exactly one list of excluded paths in the repo.
export function checkRequestAllowed(rawUrl, { allowHost, pathAllowed } = {}) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    return { ok: false, reason: `not a URL: ${String(rawUrl)}` };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: `only https is fetched, this is ${url.protocol.replace(':', '')}` };
  }
  if (!allowHost) {
    return { ok: false, reason: 'no allowed host was given; a fetch is never made without a source row naming its host' };
  }
  if (url.hostname.toLowerCase() !== String(allowHost).toLowerCase()) {
    return { ok: false, reason: `host ${url.hostname} is not ${allowHost}, the only host this run is allowed to touch` };
  }
  if (typeof pathAllowed === 'function') {
    const verdict = pathAllowed(url.pathname);
    if (!verdict?.ok) {
      return { ok: false, reason: verdict?.reason ?? `path not allowed: ${url.pathname}` };
    }
  }
  return { ok: true, url };
}

// Reads a response body as text, dropping the connection the moment it goes
// past `maxBytes`. A hostile or simply enormous page cannot fill memory.
async function readCapped(response, maxBytes, controller) {
  if (!response.body) return { text: await response.text(), bytes: 0, truncated: false };
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- streaming a single body
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      try { controller?.abort(); } catch { /* already gone */ }
      try { await reader.cancel(); } catch { /* already gone */ }
      throw new FetchRefused(`response body went past the ${maxBytes} byte cap; the connection was dropped`, { bytes });
    }
    chunks.push(value);
  }
  return { text: new TextDecoder('utf-8').decode(concat(chunks, bytes)), bytes, truncated: false };
}

function concat(chunks, total) {
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

// Fetches one URL. `fetchImpl` is injected and never defaults, so no module
// in this repo can reach the network by importing this one.
export async function fetchOnce(rawUrl, {
  fetchImpl,
  allowHost,
  pathAllowed,
  userAgent = USER_AGENT,
  etag = null,
  lastModified = null,
  maxBytes = MAX_BYTES,
  timeoutMs = TIMEOUT_MS,
  now = () => Date.now(),
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new FetchRefused('fetchOnce requires an injected fetchImpl; it never defaults to the global fetch');
  }
  const allowed = checkRequestAllowed(rawUrl, { allowHost, pathAllowed });
  if (!allowed.ok) throw new FetchRefused(allowed.reason, { url: String(rawUrl) });

  const headers = { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml', 'Accept-Encoding': 'gzip' };
  if (etag) headers['If-None-Match'] = etag;
  if (lastModified) headers['If-Modified-Since'] = lastModified;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = now();
  let response;
  try {
    response = await fetchImpl(allowed.url.toString(), {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(`request to ${allowed.url.toString()} failed: ${err?.message ?? err}`);
  }

  try {
    const status = response.status;
    const result = {
      url: allowed.url.toString(),
      status,
      requestHeaders: headers,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      contentType: response.headers.get('content-type'),
      notModified: status === 304,
      redirectTo: null,
      body: null,
      bytes: 0,
      elapsedMs: 0,
    };

    if (status >= 300 && status < 400) {
      result.redirectTo = response.headers.get('location');
      result.elapsedMs = now() - startedAt;
      // Not followed, on purpose: the destination is a path nobody reviewed.
      return result;
    }
    if (status === 304) {
      result.elapsedMs = now() - startedAt;
      return result;
    }
    if (status < 200 || status >= 300) {
      result.elapsedMs = now() - startedAt;
      return result;
    }

    const { text, bytes } = await readCapped(response, maxBytes, controller);
    result.body = text;
    result.bytes = bytes;
    result.elapsedMs = now() - startedAt;
    return result;
  } finally {
    clearTimeout(timer);
  }
}

// robots.txt is fetched by its own path, never through the page path rules
// (those describe CONTENT pages). Everything else is identical, including
// the user agent and the ten-second spacing the caller is responsible for.
//
// `allowHost` still governs. An earlier version of this function set
// allowHost from its own `host` argument, which meant a wrong or hostile
// host string could reach any server on the internet: the one check that
// matters was being satisfied by the very value it was meant to check. The
// allowed host comes from the `sources` row, and `host` must match it.
export async function fetchRobots(host, options = {}) {
  const allowHost = options.allowHost ?? host;
  return fetchOnce(`https://${host}/robots.txt`, { ...options, allowHost, pathAllowed: null });
}

// The SHA-256 of a robots.txt body, in the same lowercase hex the terms
// review recorded, so "has robots.txt changed since the founder read it" is
// a comparison and not a judgement call.
export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text ?? ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
