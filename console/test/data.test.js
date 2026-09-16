import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translateDbError } from '../src/data.js';

// A reviewer must never be shown the database's own words.
const DEVELOPER_WORDS = /constraint|SQLITE|trigger|null/i;

test('the registration link rule is stated in plain English', () => {
  const err = translateDbError(new Error("D1_ERROR: CHECK constraint failed: status <> 'approved' OR registration_url IS NOT NULL: SQLITE_CONSTRAINT"));
  assert.equal(err.status, 409);
  assert.match(err.message, /registration link/);
  assert.match(err.message, /Press E/);
  assert.doesNotMatch(err.message, DEVELOPER_WORDS);
});

test('trigger refusals keep their own wording, which is already plain', () => {
  const err = translateDbError(new Error('D1_ERROR: new rows start as draft with no approval: SQLITE_CONSTRAINT'));
  assert.equal(err.status, 409);
  assert.equal(err.message, 'new rows start as draft with no approval');
});

test('an untranslated rule says so and carries the rule text for the build session', () => {
  const err = translateDbError(new Error('D1_ERROR: CHECK constraint failed: some_future_rule > 0: SQLITE_CONSTRAINT'));
  assert.match(err.message, /no plain-English message for yet/);
  assert.match(err.message, /some_future_rule > 0/);
  assert.match(err.message, /Send this line to the build session/);
});

test('unknown errors are not swallowed', () => {
  assert.equal(translateDbError(new Error('network exploded')), null);
});
