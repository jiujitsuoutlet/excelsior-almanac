import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyTurnstile } from '../src/turnstile.js';

const fakeFetch = (impl) => async (url, opts) => impl(url, opts);

test('no secret configured: fails closed, never treated as passed', async () => {
  const result = await verifyTurnstile('some-token', undefined, '1.2.3.4', fakeFetch(() => {
    throw new Error('must never call the network with no secret');
  }));
  assert.deepEqual(result, { ok: false, reason: 'not_configured' });
});

test('no token from the client: refused before any network call', async () => {
  const result = await verifyTurnstile(undefined, 'a-real-secret', '1.2.3.4', fakeFetch(() => {
    throw new Error('must never call the network with no token');
  }));
  assert.deepEqual(result, { ok: false, reason: 'missing_token' });
});

test('a real success response is honored', async () => {
  const result = await verifyTurnstile('good-token', 'secret', '1.2.3.4', fakeFetch(async () => ({
    ok: true,
    json: async () => ({ success: true }),
  })));
  assert.deepEqual(result, { ok: true });
});

test('Cloudflare says no: refused, with the real error codes surfaced', async () => {
  const result = await verifyTurnstile('bad-token', 'secret', '1.2.3.4', fakeFetch(async () => ({
    ok: true,
    json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
  })));
  assert.equal(result.ok, false);
  assert.match(result.reason, /invalid-input-response/);
});

test('the verify request itself fails (network error): refused, not silently passed', async () => {
  const result = await verifyTurnstile('token', 'secret', '1.2.3.4', fakeFetch(async () => {
    throw new Error('boom');
  }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /verify_request_failed/);
});

test('Cloudflare itself errors (non-2xx from siteverify): refused, not silently passed', async () => {
  const result = await verifyTurnstile('token', 'secret', '1.2.3.4', fakeFetch(async () => ({ ok: false, status: 503 })));
  assert.equal(result.ok, false);
  assert.match(result.reason, /verify_http_503/);
});

test('the real request carries the token, secret, and remote IP Cloudflare expects', async () => {
  let seenBody = null;
  await verifyTurnstile('the-token', 'the-secret', '9.9.9.9', fakeFetch(async (url, opts) => {
    seenBody = new URLSearchParams(opts.body);
    return { ok: true, json: async () => ({ success: true }) };
  }));
  assert.equal(seenBody.get('response'), 'the-token');
  assert.equal(seenBody.get('secret'), 'the-secret');
  assert.equal(seenBody.get('remoteip'), '9.9.9.9');
});
