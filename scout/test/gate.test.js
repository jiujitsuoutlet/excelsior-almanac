import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSource } from '../src/gate.js';

// A fully complete, allowing source: every check should pass against this
// baseline, so each test below removes or breaks exactly one thing.
const COMPLETE = {
  host: 'example.com',
  active: 1,
  page_types: '["events"]',
  terms_url: 'https://example.com/terms',
  terms_last_updated: '2026-01-01',
  terms_read_on: '2026-09-01',
  terms_automated_access: 'none found',
  terms_reuse: 'none found',
  login_required: 0,
  official_api: 'none',
  excluded_paths: '["/registrations"]',
  robots_disallowed: '[]',
  robots_crawl_delay_seconds: null,
  robots_sha256: 'a'.repeat(64),
  robots_read_on: '2026-09-01',
  verdict: 'allowed',
  verdict_conditions: null,
  reviewed_by: 'reviewer@example.com',
  reviewed_on: '2026-09-01',
};

test('a complete, active, allowed source may be crawled', () => {
  assert.deepEqual(checkSource(COMPLETE), { allowed: true });
});

test('a source with nothing on file at all is refused, naming the first missing field', () => {
  const result = checkSource({ host: 'nothing.example.com' });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /page types to fetch/);
  assert.match(result.reason, /field 1/);
});

test('undefined and null sources are refused, not crashed on', () => {
  assert.equal(checkSource(undefined).allowed, false);
  assert.equal(checkSource(null).allowed, false);
});

// Every one of the ten fields produces its own, distinguishable reason when
// it alone is missing from an otherwise-complete review.
const FIELD_CASES = [
  ['page_types', { page_types: null }, /page types to fetch/],
  ['terms_url', { terms_url: null }, /terms URL/],
  ['terms_last_updated', { terms_last_updated: null }, /last-updated date/],
  ['terms_read_on', { terms_read_on: null }, /date the terms were read/],
  ['terms_automated_access', { terms_automated_access: null }, /prohibit automated access/],
  ['terms_reuse', { terms_reuse: null }, /restrict reuse/],
  ['login_required (unset)', { login_required: null }, /requires a login has not been recorded/],
  ['official_api', { official_api: null }, /official API/],
  ['excluded_paths', { excluded_paths: null }, /paths to exclude/],
  ['robots_disallowed', { robots_disallowed: null }, /robots\.txt has not been read/],
  ['robots_sha256', { robots_sha256: null }, /robots\.txt hash/],
  ['robots_read_on', { robots_read_on: null }, /date robots\.txt was read/],
  ['verdict', { verdict: null }, /no terms-review verdict/],
  ['reviewed_by', { reviewed_by: null }, /no reviewer name/],
  ['reviewed_on', { reviewed_on: null }, /no review date/],
];

for (const [name, patch, pattern] of FIELD_CASES) {
  test(`missing ${name} is refused with its own reason`, () => {
    const result = checkSource({ ...COMPLETE, ...patch });
    assert.equal(result.allowed, false);
    assert.match(result.reason, pattern, `expected a reason about ${name}, got: ${result.reason}`);
  });
}

test('a review complete in every field but with verdict not_allowed is refused', () => {
  const result = checkSource({ ...COMPLETE, active: 0, verdict: 'not_allowed' });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /not_allowed/);
});

test('a complete review with login_required = 1 is refused, distinctly from a missing field', () => {
  const result = checkSource({ ...COMPLETE, active: 0, login_required: 1 });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /requires a login/);
  assert.doesNotMatch(result.reason, /has not been recorded/);
});

test('allowed_with_conditions with no conditions recorded is refused', () => {
  const result = checkSource({ ...COMPLETE, verdict: 'allowed_with_conditions', verdict_conditions: null });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /no conditions recorded/);
});

test('allowed_with_conditions with conditions recorded may be crawled', () => {
  const result = checkSource({ ...COMPLETE, verdict: 'allowed_with_conditions', verdict_conditions: 'no bracket pages' });
  assert.deepEqual(result, { allowed: true });
});

test('a fully complete, allowing review that is simply not active yet is refused', () => {
  const result = checkSource({ ...COMPLETE, active: 0 });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /not marked active/);
});

test('an unrecognized verdict value is refused, not silently allowed', () => {
  const result = checkSource({ ...COMPLETE, active: 0, verdict: 'maybe' });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /not allowed or allowed_with_conditions/);
});
