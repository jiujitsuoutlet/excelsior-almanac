import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parserFor, PARSERS } from '../../src/parsers/index.js';
import { parseEventPage, parseListingPage, toDraftRow } from '../../src/parsers/smoothcomp.js';

test('smoothcomp_v1 resolves to the smoothcomp parser functions', () => {
  const parser = parserFor('smoothcomp_v1');
  assert.equal(parser.parseEventPage, parseEventPage);
  assert.equal(parser.parseListingPage, parseListingPage);
  assert.equal(parser.toDraftRow, toDraftRow);
});

test('an unknown parser name resolves to undefined, not a throw', () => {
  assert.equal(parserFor('not_a_real_parser'), undefined);
  assert.equal(parserFor(), undefined);
});

test('the registry holds exactly the one Tier 1 parser this pull request adds', () => {
  assert.deepEqual(Object.keys(PARSERS), ['smoothcomp_v1']);
});
