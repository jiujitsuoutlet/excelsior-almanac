import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots, isAllowed, crawlDelayFor, classifyRobotsFetch, matchingGroups } from '../src/robots.js';

const OUR_AGENT = 'ExcelsiorAlmanacBot';

test('an empty or missing robots.txt allows everything', () => {
  assert.equal(isAllowed(parseRobots(''), '/anything', OUR_AGENT), true);
  assert.equal(isAllowed(parseRobots(undefined), '/anything', OUR_AGENT), true);
});

test('an empty Disallow value means allowed, not refused', () => {
  const parsed = parseRobots('User-agent: *\nDisallow:\n');
  assert.equal(isAllowed(parsed, '/private', OUR_AGENT), true);
});

test('groups: only the matching user-agent applies, others do not', () => {
  const text = [
    'User-agent: SomeOtherBot',
    'Disallow: /',
    '',
    'User-agent: ExcelsiorAlmanacBot',
    'Disallow: /admin',
    'Allow: /admin/public',
  ].join('\n');
  const parsed = parseRobots(text);
  assert.equal(parsed.groups.length, 2);
  // Our own group's rule, not SomeOtherBot's blanket disallow.
  assert.equal(isAllowed(parsed, '/events', OUR_AGENT), true);
  assert.equal(isAllowed(parsed, '/admin/secret', OUR_AGENT), false);
});

test('a Disallow that does not apply to our agent does not block us', () => {
  const text = ['User-agent: SomeOtherBot', 'Disallow: /events', '', 'User-agent: *', 'Allow: /'].join('\n');
  const parsed = parseRobots(text);
  assert.equal(isAllowed(parsed, '/events', OUR_AGENT), true);
});

test('falls back to the wildcard group when no named group matches', () => {
  const text = ['User-agent: *', 'Disallow: /private'].join('\n');
  const parsed = parseRobots(text);
  assert.equal(isAllowed(parsed, '/private/page', OUR_AGENT), false);
  assert.equal(isAllowed(parsed, '/public', OUR_AGENT), true);
});

test('longest match wins, regardless of directive order', () => {
  const text = ['User-agent: *', 'Disallow: /events', 'Allow: /events/public'].join('\n');
  const parsed = parseRobots(text);
  assert.equal(isAllowed(parsed, '/events/private', OUR_AGENT), false);
  assert.equal(isAllowed(parsed, '/events/public/page', OUR_AGENT), true);
  // Reversed order in the file must not change the outcome.
  const reversed = parseRobots(['User-agent: *', 'Allow: /events/public', 'Disallow: /events'].join('\n'));
  assert.equal(isAllowed(reversed, '/events/public/page', OUR_AGENT), true);
  assert.equal(isAllowed(reversed, '/events/private', OUR_AGENT), false);
});

test('equal-length Allow and Disallow resolve to Allow', () => {
  const parsed = parseRobots(['User-agent: *', 'Disallow: /x', 'Allow: /x'].join('\n'));
  assert.equal(isAllowed(parsed, '/x', OUR_AGENT), true);
});

test('crawl-delay is read per group, absent when not declared', () => {
  const parsed = parseRobots(['User-agent: *', 'Crawl-delay: 25', 'Disallow: /admin'].join('\n'));
  assert.equal(crawlDelayFor(parsed, OUR_AGENT), 25);
  assert.equal(crawlDelayFor(parseRobots('User-agent: *\nDisallow: /'), OUR_AGENT), null);
});

test('sitemap lines are collected regardless of where they appear', () => {
  const text = [
    'Sitemap: https://example.com/sitemap-1.xml',
    'User-agent: *',
    'Disallow: /admin',
    'Sitemap: https://example.com/sitemap-2.xml',
  ].join('\n');
  const parsed = parseRobots(text);
  assert.deepEqual(parsed.sitemaps, ['https://example.com/sitemap-1.xml', 'https://example.com/sitemap-2.xml']);
});

test('malformed input degrades to fewer rules, never a thrown error', () => {
  const garbage = ['not a directive at all', '::::', 'User-agent', 'Disallow', '# just a comment', ''].join('\n');
  assert.doesNotThrow(() => parseRobots(garbage));
  const parsed = parseRobots(garbage);
  assert.equal(isAllowed(parsed, '/anything', OUR_AGENT), true);
  assert.doesNotThrow(() => parseRobots(null));
  assert.doesNotThrow(() => parseRobots(12345));
});

test('a repeated User-agent line after rules starts a fresh record', () => {
  // Real-world files sometimes repeat a block. Rules after the second
  // declaration must not silently merge into the first record's rules.
  const text = [
    'User-agent: *',
    'Disallow: /a',
    'User-agent: *',
    'Disallow: /b',
  ].join('\n');
  const parsed = parseRobots(text);
  assert.equal(parsed.groups.length, 2);
  assert.equal(isAllowed(parsed, '/a', OUR_AGENT), false);
  assert.equal(isAllowed(parsed, '/b', OUR_AGENT), false);
});

test('matchingGroups prefers the most specific named token over the wildcard', () => {
  const parsed = parseRobots(['User-agent: *', 'Disallow: /', '', 'User-agent: excelsioralmanacbot', 'Disallow:'].join('\n'));
  const groups = matchingGroups(parsed, OUR_AGENT);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].userAgents[0], 'excelsioralmanacbot');
  assert.equal(isAllowed(parsed, '/anything', OUR_AGENT), true);
});

test('matchingGroups merges repeated groups for the same agent instead of using only the first', () => {
  const parsed = parseRobots(['User-agent: *', 'Disallow: /a', 'User-agent: *', 'Disallow: /b'].join('\n'));
  assert.equal(matchingGroups(parsed, OUR_AGENT).length, 2);
});

test('classifyRobotsFetch names the rule for each HTTP status, without fetching anything', () => {
  assert.equal(classifyRobotsFetch(404), 'allow_all');
  assert.equal(classifyRobotsFetch(200), 'parse');
  assert.equal(classifyRobotsFetch(500), 'skip_host');
  assert.equal(classifyRobotsFetch(503), 'skip_host');
  assert.equal(classifyRobotsFetch(429), 'skip_host');
  assert.equal(classifyRobotsFetch(403), 'skip_host');
});
