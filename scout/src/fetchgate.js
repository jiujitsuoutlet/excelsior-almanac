// THE chokepoint (founder ruling, 2026-09-21): "ONE function decides whether
// any code path may fetch a given URL, every fetch in Scout goes through it,
// and a test proves there is no other fetch path. If a fourth instance of
// this bug is possible after that, the chokepoint is wrong."
//
// The bug it exists to end: one rule written in two places and missed in a
// third, three times. Link-check fetched an excluded /order/ path while
// discovery and ingest checked it (Opus review, B1). Link-check never ran
// the terms gate while discovery and ingest did (B2). And after listing_only
// existed, ingest refused event pages for it but link-check did not, so a
// legacy approved row with a NULL method live-fetched a Smoothcomp event
// page in production, took the 403 and paused the source (2026-09-21).
//
// So the rules live HERE, once, and a caller cannot opt out of any of them:
//
//   1. https, and a parseable URL.
//   2. The source passes the terms-review gate (checkSource), which also
//      means it is active: an operator stopping a source stops EVERY fetch.
//   3. The host is one of the source's own active, reviewed aliases.
//   4. The URL is one of exactly three reviewed shapes, decided from the URL
//      itself rather than from what the caller says it is doing:
//        robots     /robots.txt on that alias
//        listing    exactly that alias's own reviewed listing_path
//        event_page a path the source's parser allows (its single exclusion
//                   list), AND only when the source is not listing_only
//      Anything else is refused.
//   5. The shared per-company clock is claimed for every request except
//      robots.txt (a robots read is the crawler asking permission, not
//      crawling, and the daily drift check must be able to run first).
//
// fetchOnce() itself keeps its own https/host/redirect/byte-cap checks as a
// second layer; it can only ADD refusals to this decision, never allowances.
// Nothing in scout/src may import fetchOnce except this file
// (scout/test/no-other-fetch-path.test.js reads every source file to prove it).

import { checkSource } from './gate.js';
import { fetchOnce } from './fetcher.js';
import { parserForSource } from './parsers/index.js';

export const FETCH_KINDS = ['robots', 'listing', 'event_page'];

/**
 * Pure. Decides whether `rawUrl` may be requested at all, and as what.
 * @param {string} rawUrl
 * @param {{ source: object, aliases: Array<{ host: string, listingPath: string }> }} ctx
 * @returns {{ ok: true, kind: string, host: string } | { ok: false, code: string, reason: string }}
 */
export function decideFetch(rawUrl, { source, aliases } = {}) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    return { ok: false, code: 'malformed', reason: `not a URL: ${String(rawUrl)}` };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, code: 'not_https', reason: `only https is fetched, this is ${url.protocol.replace(':', '')}` };
  }
  if (url.username || url.password) {
    return { ok: false, code: 'malformed', reason: 'a URL carrying credentials is never fetched' };
  }

  const gate = checkSource(source);
  if (!gate.allowed) return { ok: false, code: 'source_gate', reason: gate.reason };

  const host = url.hostname.toLowerCase();
  const alias = (aliases ?? []).find((a) => String(a?.host ?? '').toLowerCase() === host);
  if (!alias) {
    return { ok: false, code: 'not_active_alias', reason: `${host} is not an active, reviewed alias of ${source.id}` };
  }

  const pathAndQuery = `${url.pathname}${url.search}`;
  if (url.pathname === '/robots.txt' && !url.search) return { ok: true, kind: 'robots', host };
  if (alias.listingPath && pathAndQuery === alias.listingPath) return { ok: true, kind: 'listing', host };

  const parser = parserForSource(source);
  if (!parser) return { ok: false, code: 'no_parser', reason: `no parser registered for ${source.parser ?? source.id}` };
  const verdict = parser.pathAllowed(url.pathname, { host });
  if (!verdict.ok) return { ok: false, code: 'path_not_allowed', reason: verdict.reason };

  // Last, on purpose: a listing_only source's event pages are refused even
  // when the path itself is a perfectly allowed event-detail shape. That is
  // the whole meaning of listing_only.
  if (source.crawl_mode === 'listing_only') {
    return { ok: false, code: 'listing_only', reason: `${source.id} is listing_only: its event pages are never fetched` };
  }
  return { ok: true, kind: 'event_page', host };
}

/**
 * The only function in Scout that makes a request.
 * @returns {Promise<{ refused: {code:string, reason:string} } | { rateLimited: true } | { kind: string, response: object }>}
 *   A network failure or fetcher.js's own second-layer refusal still throws,
 *   exactly as fetchOnce does, so callers keep their existing handling.
 */
export async function gatedFetch(rawUrl, { source, aliases, fetchImpl, claimSlot, now }) {
  const decision = decideFetch(rawUrl, { source, aliases });
  if (!decision.ok) return { refused: { code: decision.code, reason: decision.reason } };

  if (decision.kind !== 'robots') {
    if (typeof claimSlot !== 'function') throw new Error('gatedFetch requires claimSlot for every non-robots request');
    const claimed = await claimSlot(source, now);
    if (!claimed) return { rateLimited: true };
  }

  const parser = decision.kind === 'event_page' ? parserForSource(source) : null;
  const response = await fetchOnce(rawUrl, {
    fetchImpl,
    allowHost: decision.host,
    pathAllowed: parser ? (p) => parser.pathAllowed(p, { host: decision.host }) : null,
    now: () => now,
  });
  return { kind: decision.kind, response };
}
