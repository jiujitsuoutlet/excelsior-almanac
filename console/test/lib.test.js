import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  queueHeadline, dedupeKey, normalizeText, nameSimilarity, isRealDate, validateEventInput,
  chipFor, chipsFor, duplicateState, approvalEligibility, approvalBlockers, weekdayDate, daysUntil, precisionByHost,
} from '../src/lib.js';

test('headline shows the count and minutes before you start', () => {
  assert.equal(queueHeadline(0), 'Nothing to review');
  assert.equal(queueHeadline(1), '1 row, about 1 minute');
  assert.equal(queueHeadline(12), '12 rows, about 4 minutes');
  assert.equal(queueHeadline(200), '200 rows, about 67 minutes');
});

test('dedupe key ignores case, accents, punctuation and years', () => {
  const a = dedupeKey({ name: 'Fuji BJJ Championship 2027!', start_date: '2027-03-06', country: 'US', state: 'MO', city: 'Springfield' });
  const b = dedupeKey({ name: 'fuji bjj  championship', start_date: '2027-03-06', country: 'US', state: 'MO', city: 'SPRINGFIELD' });
  assert.equal(a, b);
  assert.equal(normalizeText('São Paulo Open'), 'sao paulo open');
});

test('name similarity', () => {
  assert.ok(nameSimilarity('NAGA Ozarks Championship', 'NAGA Ozarks') >= 0.5);
  assert.ok(nameSimilarity('Fuji Springfield', 'Grappling Industries St Louis') < 0.5);
});

test('real dates only', () => {
  assert.ok(isRealDate('2027-02-28'));
  assert.ok(!isRealDate('2027-02-30'));
  assert.ok(!isRealDate('03/06/2027'));
});

test('event input validation', () => {
  const ok = validateEventInput({
    event_type: 'tournament', name: 'Verify Open', start_date: '2027-03-06', city: 'Springfield',
    state: 'mo', country: 'us', registration_url: 'https://example.com/r', source_url: 'https://example.com/e',
  });
  assert.ok(ok.ok, JSON.stringify(ok.errors));
  assert.equal(ok.value.state, 'MO');
  assert.equal(ok.value.country, 'US');

  const bad = validateEventInput({
    event_type: 'party', name: '', start_date: '2027-02-30', city: '', state: 'Missouri', country: 'USA',
    registration_url: 'http://example.com', source_url: 'javascript:alert(1)', end_date: '2026-01-01',
  });
  assert.ok(!bad.ok);
  for (const f of ['event_type', 'name', 'start_date', 'city', 'state', 'country', 'registration_url', 'source_url']) {
    assert.ok(bad.errors[f], `expected an error for ${f}`);
  }
});

const event = {
  name: 'Verify Open', start_date: '2027-03-06', city: 'Springfield', state: 'MO', country: 'US',
  registration_url: 'https://example.com/r', venue_name: null, end_date: null, registration_deadline: null, organizer_name: null,
};
const green = [
  { id: 1, signal: 'grounding', passed: 1, evidence: { field: 'name', value: 'Verify Open' } },
  { id: 2, signal: 'grounding', passed: 1, evidence: { field: 'start_date', value: '2027-03-06' } },
  { id: 3, signal: 'grounding', passed: 1, evidence: { field: 'location', value: 'Springfield, MO, US' } },
  { id: 4, signal: 'link_live', passed: 1, evidence: { url: 'https://example.com/r' } },
];

test('chips: green when confirmed, amber when not, grey when unchecked or edited since', () => {
  assert.equal(chipFor('name', event, green), 'green');
  assert.equal(chipFor('name', event, []), 'grey');
  assert.equal(chipFor('name', event, [{ id: 9, signal: 'grounding', passed: 0, evidence: { field: 'name', value: 'Verify Open' } }]), 'amber');
  assert.equal(chipFor('name', { ...event, name: 'Edited' }, green), 'grey');
  assert.equal(chipFor('registration_url', { ...event, registration_url: 'https://other.example/r' }, green), 'grey');
  assert.equal(chipFor('registration_url', { ...event, registration_url: null }, green), 'amber');
  // The latest check wins.
  assert.equal(chipFor('start_date', event, [...green, { id: 10, signal: 'grounding', passed: 0, evidence: { field: 'start_date', value: '2027-03-06' } }]), 'amber');
});

test('plain A only when every critical field is green and no duplicate is open', () => {
  const none = { candidates: [], unresolved: [] };
  assert.equal(approvalEligibility(chipsFor(event, green), none).plain, true);
  // A hand entry has no signals: every chip grey, so Shift+A is required.
  const hand = approvalEligibility(chipsFor(event, []), none);
  assert.equal(hand.plain, false);
  assert.ok(hand.reasons.includes('Date not checked'));
  // One amber critical field forces Shift+A.
  const amber = [...green.filter((s) => s.id !== 2), { id: 11, signal: 'grounding', passed: 0, evidence: { field: 'start_date', value: '2027-03-06' } }];
  assert.equal(approvalEligibility(chipsFor(event, amber), none).plain, false);
  // An unresolved duplicate forces Shift+A even when everything is green.
  const dupe = { candidates: [{ id: 'x' }], unresolved: [{ id: 'x' }] };
  assert.equal(approvalEligibility(chipsFor(event, green), dupe).plain, false);
});

test('duplicates clear only when marked distinct from every candidate', () => {
  const e = { ...event, id: 'e1' };
  const candidates = [
    { id: 'c1', name: 'Verify Open', city: 'Springfield' },
    { id: 'c2', name: 'Totally Different', city: 'Joplin' },
  ];
  const open = duplicateState(e, candidates, []);
  assert.deepEqual(open.unresolved.map((c) => c.id), ['c1']);
  const cleared = duplicateState(e, candidates, [{ id: 5, signal: 'duplicate_score', passed: 1, evidence: { resolved: 'distinct', candidate_ids: ['c1'] } }]);
  assert.equal(cleared.unresolved.length, 0);
  const newCandidate = duplicateState(e, [...candidates, { id: 'c3', name: 'Verify Open II', city: 'Springfield' }],
    [{ id: 5, signal: 'duplicate_score', passed: 1, evidence: { resolved: 'distinct', candidate_ids: ['c1'] } }]);
  assert.deepEqual(newCandidate.unresolved.map((c) => c.id), ['c3']);
});

test('an event with no registration link cannot be approved at all', () => {
  const none = { candidates: [], unresolved: [] };
  const noLink = { ...event, registration_url: null };
  const blockers = approvalBlockers(noLink);
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].field, 'registration_url');
  assert.match(blockers[0].message, /must have one/);
  assert.match(blockers[0].fix, /Press E/);
  // Neither A nor Shift\+A: eligibility is not plain, and the blocker is carried.
  const gate = approvalEligibility(chipsFor(noLink, green), none, noLink);
  assert.equal(gate.plain, false);
  assert.equal(gate.blockers.length, 1);
  // With a link, the same row has no blockers.
  assert.equal(approvalEligibility(chipsFor(event, green), none, event).blockers.length, 0);
});

test('date display', () => {
  assert.equal(weekdayDate('2027-03-06'), 'Sat, Mar 6, 2027');
  assert.equal(daysUntil('2027-03-06', '2027-03-01'), 5);
});

test('precision is approved over decided per host, and null (not 0 or 1) with no decisions', () => {
  const rows = [
    { source_host: 'b.example.com', decision: 'approved', n: 3 },
    { source_host: 'b.example.com', decision: 'rejected', n: 1 },
    { source_host: 'a.example.com', decision: 'rejected', n: 2 },
  ];
  assert.deepEqual(precisionByHost(rows), [
    { host: 'a.example.com', approved: 0, rejected: 2, decided: 2, precision: 0 },
    { host: 'b.example.com', approved: 3, rejected: 1, decided: 4, precision: 0.75 },
  ]);
  assert.deepEqual(precisionByHost([]), []);
  assert.equal(precisionByHost([{ source_host: 'c', decision: 'other', n: 5 }])[0].precision, null);
});

test('a structural link check never renders as a live one, and keeps the row out of plain-A range', () => {
  const event = { registration_url: 'https://fujibjj.smoothcomp.com/en/event/1', link_check_method: 'structural', city: 'Independence', state: 'MO', country: 'US', name: 'X', start_date: '2027-01-01' };
  assert.equal(chipFor('registration_url', event, []), 'structural');
  // even with a passing live signal recorded, the row's own method wins
  const signals = [{ id: 1, signal: 'link_live', passed: 1, evidence: { url: event.registration_url } }];
  assert.equal(chipFor('registration_url', event, signals), 'structural');
  const chips = { name: 'green', start_date: 'green', location: 'green', registration_url: 'structural' };
  const eligibility = approvalEligibility(chips, { unresolved: [] }, event);
  assert.equal(eligibility.plain, false, 'a structurally-checked link must need the deliberate Shift+A');
  assert.ok(eligibility.reasons.some((r) => /Registration link/.test(r)));
});

test('a derived state renders as derived, not as found-on-page', () => {
  const event = { state_source: 'derived', city: 'Independence', state: 'MO', country: 'US', registration_url: 'https://x.smoothcomp.com/en/event/1' };
  assert.equal(chipFor('location', event, []), 'derived');
  const chips = { name: 'green', start_date: 'green', location: 'derived', registration_url: 'green' };
  assert.equal(approvalEligibility(chips, { unresolved: [] }, event).plain, false);
});

test('a scraped, live row is unaffected -- the new states never weaken an existing green', () => {
  const event = { registration_url: 'https://smoothcomp.com/en/event/1/register', city: 'Testburg', state: 'MO', country: 'US' };
  const signals = [{ id: 1, signal: 'link_live', passed: 1, evidence: { url: event.registration_url } }];
  assert.equal(chipFor('registration_url', event, signals), 'green');
});
