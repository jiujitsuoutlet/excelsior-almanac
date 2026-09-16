import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchOnce, fetchRobots, checkRequestAllowed, sha256Hex, FetchRefused, MAX_BYTES } from '../src/fetcher.js';
import { pathAllowed } from '../src/parsers/smoothcomp.js';
import { USER_AGENT } from '../src/identity.js';

const HOST = 'smoothcomp.com';
const EVENT = `https://${HOST}/en/event/900001/fixture-open-2027`;

// This module must never be able to reach the real network by accident: the
// global fetch is replaced with a counter that throws, for the whole file.
let globalFetchCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (...args) => {
  globalFetchCalls += 1;
  throw new Error(`the fetcher tests must never use the global fetch; called with ${JSON.stringify(args[0])}`);
};
test.after(() => { globalThis.fetch = realFetch; });

// A recording stand-in for fetch. Returns real Response objects, so header
// reading, status handling and body streaming behave as they will in
// production; only the socket is missing.
function recorder(respond) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  impl.calls = calls;
  return impl;
}

const okHtml = () => new Response('<html>hello</html>', { status: 200, headers: { 'Content-Type': 'text/html', ETag: '"abc"', 'Last-Modified': 'Tue, 15 Sep 2026 10:00:00 GMT' } });

test('the request carries the exact ratified user agent, and asks for html', async () => {
  const impl = recorder(okHtml);
  const result = await fetchOnce(EVENT, { fetchImpl: impl, allowHost: HOST, pathAllowed });
  assert.equal(impl.calls.length, 1);
  assert.equal(impl.calls[0].init.headers['User-Agent'], USER_AGENT);
  assert.match(impl.calls[0].init.headers['User-Agent'], /contact paul@jiujitsuoutlet\.com/);
  assert.equal(impl.calls[0].init.method, 'GET');
  assert.equal(impl.calls[0].init.redirect, 'manual', 'redirects are reported, never followed');
  assert.equal(result.status, 200);
  assert.equal(result.body, '<html>hello</html>');
  assert.equal(result.etag, '"abc"');
});

test('a conditional request is sent when we have been here before, and a 304 costs no body', async () => {
  const impl = recorder(() => new Response(null, { status: 304 }));
  const result = await fetchOnce(EVENT, {
    fetchImpl: impl, allowHost: HOST, pathAllowed,
    etag: '"abc"', lastModified: 'Tue, 15 Sep 2026 10:00:00 GMT',
  });
  assert.equal(impl.calls[0].init.headers['If-None-Match'], '"abc"');
  assert.equal(impl.calls[0].init.headers['If-Modified-Since'], 'Tue, 15 Sep 2026 10:00:00 GMT');
  assert.equal(result.notModified, true);
  assert.equal(result.body, null, 'a 304 must not produce a body; that is the point of asking');
});

test('a first visit sends no conditional headers (there is nothing to condition on)', async () => {
  const impl = recorder(okHtml);
  await fetchOnce(EVENT, { fetchImpl: impl, allowHost: HOST, pathAllowed });
  assert.equal('If-None-Match' in impl.calls[0].init.headers, false);
  assert.equal('If-Modified-Since' in impl.calls[0].init.headers, false);
});

test('every refusal happens BEFORE the request leaves: the fetcher is never called', async () => {
  const never = recorder(() => { throw new Error('this must not run'); });
  const cases = [
    [`http://${HOST}/en/event/900001/x`, /only https/],
    ['https://example.com/en/event/900001/x', /is not smoothcomp\.com/],
    [`https://${HOST}/en/event/900001/brackets`, /brackets/],
    [`https://${HOST}/en/event/900001/registrations`, /registrant list/],
    [`https://${HOST}/en/athlete/44/someone`, /athlete profile/],
    [`https://${HOST}/order/1234`, /order\/checkout/],
    [`https://${HOST}/en/events`, /not an event detail page path/],
    ['not a url at all', /not a URL/],
  ];
  for (const [url, expected] of cases) {
    // eslint-disable-next-line no-await-in-loop -- one assertion at a time
    await assert.rejects(
      fetchOnce(url, { fetchImpl: never, allowHost: HOST, pathAllowed }),
      expected,
      `${url} must be refused`,
    );
  }
  assert.equal(never.calls.length, 0, 'not one of those refusals reached the network step');
});

test('with no allowed host named, nothing can be fetched at all', async () => {
  const never = recorder(() => { throw new Error('this must not run'); });
  await assert.rejects(fetchOnce(EVENT, { fetchImpl: never, pathAllowed }), /no allowed host was given/);
  assert.equal(never.calls.length, 0);
});

test('fetchOnce refuses to default to the global fetch', async () => {
  await assert.rejects(fetchOnce(EVENT, { allowHost: HOST, pathAllowed }), /never defaults to the global fetch/);
  assert.equal(globalFetchCalls, 0);
});

test('a redirect is reported and NOT followed', async () => {
  const impl = recorder(() => new Response(null, { status: 301, headers: { Location: 'https://smoothcomp.com/en/event/900001/brackets' } }));
  const result = await fetchOnce(EVENT, { fetchImpl: impl, allowHost: HOST, pathAllowed });
  assert.equal(impl.calls.length, 1, 'exactly one request: the redirect was not chased');
  assert.equal(result.status, 301);
  assert.equal(result.redirectTo, 'https://smoothcomp.com/en/event/900001/brackets');
  assert.equal(result.body, null);
});

test('a body past the cap drops the connection instead of filling memory', async () => {
  let enqueued = 0;
  const impl = recorder(() => new Response(new ReadableStream({
    pull(controller) {
      enqueued += 1;
      controller.enqueue(new Uint8Array(1024));
      if (enqueued > 1000) controller.close();
    },
  }), { status: 200 }));
  await assert.rejects(
    fetchOnce(EVENT, { fetchImpl: impl, allowHost: HOST, pathAllowed, maxBytes: 10_000 }),
    (err) => err instanceof FetchRefused && /past the 10000 byte cap/.test(err.message),
  );
  assert.ok(enqueued < 1000, 'the stream was cut off early, not read to the end');
});

test('a body under the cap comes back whole, with its byte count', async () => {
  const impl = recorder(() => new Response('x'.repeat(5000), { status: 200 }));
  const result = await fetchOnce(EVENT, { fetchImpl: impl, allowHost: HOST, pathAllowed, maxBytes: 10_000 });
  assert.equal(result.bytes, 5000);
  assert.equal(result.body.length, 5000);
});

test('a non-2xx answer is returned as a fact, not an exception, and carries no body', async () => {
  for (const status of [403, 404, 429, 500, 503]) {
    const impl = recorder(() => new Response('nope', { status }));
    // eslint-disable-next-line no-await-in-loop -- one status at a time
    const result = await fetchOnce(EVENT, { fetchImpl: impl, allowHost: HOST, pathAllowed });
    assert.equal(result.status, status);
    assert.equal(result.body, null);
  }
});

test('a network failure names the URL it was trying, and does not pretend to be a refusal', async () => {
  const impl = recorder(() => { throw new Error('ECONNRESET'); });
  await assert.rejects(
    fetchOnce(EVENT, { fetchImpl: impl, allowHost: HOST, pathAllowed }),
    (err) => !(err instanceof FetchRefused) && /failed: ECONNRESET/.test(err.message),
  );
});

test('the request is abortable: a hung server does not hold the connection forever', async () => {
  const impl = recorder((url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  await assert.rejects(fetchOnce(EVENT, { fetchImpl: impl, allowHost: HOST, pathAllowed, timeoutMs: 40 }), /failed: aborted/);
});

test('robots.txt is fetched at its own path, with the same user agent', async () => {
  const impl = recorder(() => new Response('User-agent: *\nDisallow:\n', { status: 200 }));
  const result = await fetchRobots(HOST, { fetchImpl: impl });
  assert.equal(impl.calls[0].url, 'https://smoothcomp.com/robots.txt');
  assert.equal(impl.calls[0].init.headers['User-Agent'], USER_AGENT);
  assert.equal(result.status, 200);
});

test('robots.txt on another host is still refused', async () => {
  const never = recorder(() => { throw new Error('this must not run'); });
  await assert.rejects(fetchRobots('example.com', { fetchImpl: never, allowHost: HOST }), /is not example\.com|is not smoothcomp\.com/);
});

test('sha256Hex produces the lowercase hex the terms review records', async () => {
  assert.equal(
    await sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    'the known SHA-256 of "abc"',
  );
  assert.match(await sha256Hex('User-agent: *\n'), /^[0-9a-f]{64}$/);
});

test('checkRequestAllowed is usable on its own, and the default cap is two megabytes', () => {
  assert.equal(checkRequestAllowed(EVENT, { allowHost: HOST, pathAllowed }).ok, true);
  assert.equal(checkRequestAllowed(EVENT, { allowHost: 'other.com', pathAllowed }).ok, false);
  assert.equal(MAX_BYTES, 2_000_000);
});

test('the global fetch counter never moved (nothing here touched the real network)', () => {
  assert.equal(globalFetchCalls, 0);
});
