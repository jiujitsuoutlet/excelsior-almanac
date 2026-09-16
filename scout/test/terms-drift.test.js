import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { classifyUrl, pathAllowed } from '../src/parsers/smoothcomp.js';

// The founder's terms review records, in English, the paths this crawler may
// never touch. The code enforces that with regexes. Those are two separate
// hand-written things describing one rule, which is exactly the shape that
// has produced three false passes in this build already: the gate field
// list, the drift regex, and the parser battery's column list. So the
// English record is READ here, and the code is made to answer to it.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REVIEW_SQL = readFileSync(path.join(HERE, '..', 'terms-reviews', 'smoothcomp.sql'), 'utf8');

// The two JSON arrays in the review row: excluded_paths (field 7) and
// robots_disallowed (field 8).
function jsonArraysIn(sql) {
  const found = [];
  const re = /'(\[[^']*\])'/g;
  let match = re.exec(sql);
  while (match) {
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) found.push(parsed);
    } catch {
      // not a JSON array after all; the assertions below catch a real problem
    }
    match = re.exec(sql);
  }
  return found;
}

const ARRAYS = jsonArraysIn(REVIEW_SQL);

test('the terms review file really does carry two readable path lists (if this fails, the test below is reading nothing)', () => {
  assert.equal(ARRAYS.length, 2, `expected excluded_paths and robots_disallowed, found ${ARRAYS.length} JSON arrays`);
  assert.ok(ARRAYS[0].length >= 4, 'excluded_paths should list several paths');
  assert.ok(ARRAYS[1].length >= 1, 'robots_disallowed should list at least one path');
});

const [EXCLUDED_PATHS, ROBOTS_DISALLOWED] = ARRAYS;
const pathShaped = (entry) => typeof entry === 'string' && entry.startsWith('/');

test('every path the founder wrote down as excluded is actually refused by the code', () => {
  const checked = [];
  for (const entry of [...EXCLUDED_PATHS, ...ROBOTS_DISALLOWED].filter(pathShaped)) {
    const url = `https://smoothcomp.com${entry}${entry.endsWith('/') ? '' : '/'}something`;
    const verdict = classifyUrl(url);
    assert.equal(verdict.ok, false, `the review excludes "${entry}" but the code would allow ${url}`);
    checked.push(entry);
  }
  assert.ok(checked.length >= 3, `expected to check several recorded paths, checked ${checked.length}`);
});

// The prose entries in the review ("athlete profiles", "any page listing
// people") cannot be turned into a URL by a machine without someone typing
// the mapping by hand, which is the very thing this file exists to avoid.
// They are covered instead by the opposite guarantee: the allow-list is a
// single narrow shape, so anything that is not an event detail page is
// refused whether or not anyone thought to name it.
test('the allow-list is narrow: anything but an event detail page is refused, named or not', () => {
  const notEventPages = [
    '/', '/en', '/en/events', '/en/federation/12', '/en/club/88/some-academy',
    '/en/event', '/en/event/', '/en/event/abc', '/en/event/900001/brackets/44',
    '/en/user/3', '/en/athlete/9/name', '/api/events', '/en/event/900001/x/y/z',
    '/EN/EVENT/900001/brackets', '/en/event/900001/results?x=1',
  ];
  for (const p of notEventPages) {
    assert.equal(pathAllowed(p).ok, false, `${p} must not be fetchable`);
  }
  // ... and the one shape that IS allowed, so this test can fail both ways.
  assert.equal(pathAllowed('/en/event/900001/fixture-open-2027').ok, true);
  assert.equal(pathAllowed('/en/event/900001').ok, true);
});

test('the review names smoothcomp.com and a ten second delay, and the code agrees', async () => {
  assert.match(REVIEW_SQL, /'smoothcomp\.com'/);
  const delay = REVIEW_SQL.match(/^\s*(\d+),\s*$/m);
  assert.ok(delay, 'the review should record a crawl delay');
  const { minIntervalSeconds } = await import('../src/limiter.js');
  assert.ok(
    minIntervalSeconds(Number(delay[1])) >= 10,
    'the enforced interval must never be shorter than ten seconds',
  );
});
