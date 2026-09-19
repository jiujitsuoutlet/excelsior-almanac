import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groundPage } from '../src/grounding.js';

const REAL_PAGE_FILLER = 'x'.repeat(500);

test('a real 200 page with real content grounds', () => {
  const result = groundPage({ status: 200, body: `<html><body>${REAL_PAGE_FILLER}</body></html>`, redirectTo: null, notModified: false });
  assert.deepEqual(result, { grounded: true });
});

test('a redirect never grounds, whatever the destination', () => {
  const result = groundPage({ status: 302, body: null, redirectTo: 'https://smoothcomp.com/en/login', notModified: false });
  assert.equal(result.grounded, false);
  assert.match(result.reason, /redirected/);
});

test('304 Not Modified never grounds (no new content to trust)', () => {
  const result = groundPage({ status: 304, body: null, redirectTo: null, notModified: true });
  assert.equal(result.grounded, false);
  assert.match(result.reason, /304/);
});

test('a non-2xx status never grounds', () => {
  for (const status of [403, 404, 500, 503]) {
    const result = groundPage({ status, body: `<html>${REAL_PAGE_FILLER}</html>`, redirectTo: null, notModified: false });
    assert.equal(result.grounded, false, `status ${status} should not ground`);
    assert.match(result.reason, new RegExp(String(status)));
  }
});

test('a suspiciously short body never grounds, even with a real 200', () => {
  const result = groundPage({ status: 200, body: '<html>tiny</html>', redirectTo: null, notModified: false });
  assert.equal(result.grounded, false);
  assert.match(result.reason, /too short/);
});

test('a Cloudflare "checking your browser" interstitial never grounds despite HTTP 200', () => {
  const result = groundPage({
    status: 200,
    body: `<html><body>Checking your browser before accessing smoothcomp.com. ${REAL_PAGE_FILLER}</body></html>`,
    redirectTo: null,
    notModified: false,
  });
  assert.equal(result.grounded, false);
  assert.match(result.reason, /Cloudflare/);
});

test('a "Just a moment..." Cloudflare interstitial never grounds', () => {
  const result = groundPage({
    status: 200,
    body: `<html><title>Just a moment...</title><body>${REAL_PAGE_FILLER} Cloudflare needs to review the security of your connection.</body></html>`,
    redirectTo: null,
    notModified: false,
  });
  assert.equal(result.grounded, false);
});

test('a CAPTCHA challenge never grounds', () => {
  const result = groundPage({
    status: 200,
    body: `<html><body>${REAL_PAGE_FILLER}<div class="g-recaptcha" data-sitekey="x"></div></body></html>`,
    redirectTo: null,
    notModified: false,
  });
  assert.equal(result.grounded, false);
  assert.match(result.reason, /CAPTCHA/);
});

test('a real page that merely mentions logging in to register still grounds -- content about login is not a login wall', () => {
  const result = groundPage({
    status: 200,
    body: `<html><body>${REAL_PAGE_FILLER} Please log in to your Smoothcomp account to complete registration for this event.</body></html>`,
    redirectTo: null,
    notModified: false,
  });
  assert.deepEqual(result, { grounded: true });
});

test('missing/malformed response shape refuses rather than throwing', () => {
  assert.equal(groundPage(undefined).grounded, false);
  assert.equal(groundPage({}).grounded, false);
  assert.equal(groundPage({ status: 200 }).grounded, false); // no body at all
});
