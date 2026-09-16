import { test } from 'node:test';
import assert from 'node:assert/strict';
import { USER_AGENT, ROBOTS_TOKEN } from '../src/identity.js';

// The founder read this string and approved it. Pin it: a silent edit would
// change what every site admin sees in their logs.
test('the user agent is exactly the ratified string', () => {
  assert.equal(USER_AGENT, 'ExcelsiorAlmanacBot/1.0 (Outlet Academy events database; contact paul@jiujitsuoutlet.com)');
});

test('the user agent names a reachable contact and no dead link', () => {
  assert.match(USER_AGENT, /contact paul@jiujitsuoutlet\.com/);
  assert.doesNotMatch(USER_AGENT, /https?:\/\//, 'no URL until the bot page exists');
});

test('the robots token is the agent name', () => {
  assert.ok(USER_AGENT.startsWith(`${ROBOTS_TOKEN}/`));
});
