import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planEventUpsert } from '../src/ingest.js';

const DRAFT = {
  id: 'evt-new',
  event_type: 'tournament',
  name: 'Fixture Open 2027',
  organizer_name: 'Fixture Organizer',
  start_date: '2027-06-01',
  end_date: null,
  venue_name: null,
  address: null,
  city: 'Testburg',
  state: 'MO',
  country: 'US',
  registration_url: 'https://fujibjj.smoothcomp.com/en/event/900001/register',
  registration_deadline: null,
  gi: 1,
  nogi: 1,
  kids: 0,
  source_url: 'https://fujibjj.smoothcomp.com/en/event/900001',
  source_host: 'fujibjj.smoothcomp.com',
  source_event_ref: '900001',
  source_tier: 1,
  dedupe_key: 'fixture open 2027|2027-06-01|US|MO|testburg',
};

test('a never-seen-before event inserts as draft and transitions to needs_review, actor is a real system: identity', () => {
  const { outcome, statements } = planEventUpsert({ existing: null, draft: DRAFT, actor: 'system:scout-src-smoothcomp', nowIso: '2027-01-01T00:00:00.000Z' });
  assert.equal(outcome, 'inserted');
  assert.equal(statements.length, 3);
  assert.equal(statements[0].kind, 'insert_event');
  assert.equal(statements[0].row.id, 'evt-new');
  assert.ok(!('status' in statements[0].row), 'the parser/plan never sets status; the insert-time trigger owns it');
  assert.equal(statements[1].kind, 'review_log_create');
  assert.equal(statements[2].kind, 'review_log_transition');
  assert.equal(statements[2].from, 'draft');
  assert.equal(statements[2].to, 'needs_review');
  assert.match(statements[2].actor, /^system:/);
});

test('an existing row with identical content is only touched for last_seen_at -- no needless review_log churn', () => {
  const existing = { ...DRAFT, id: 'evt-existing', status: 'needs_review' };
  const { outcome, statements } = planEventUpsert({ existing, draft: DRAFT, actor: 'system:scout-src-smoothcomp', nowIso: '2027-01-02T00:00:00.000Z' });
  assert.equal(outcome, 'unchanged');
  assert.deepEqual(statements, [{ kind: 'touch_last_seen', id: 'evt-existing', nowIso: '2027-01-02T00:00:00.000Z' }]);
});

test('a needs_review row with real content changes updates directly -- no demotion needed, it was never approved', () => {
  const existing = { ...DRAFT, id: 'evt-existing', status: 'needs_review', name: 'Old Name' };
  const { outcome, statements } = planEventUpsert({ existing, draft: DRAFT, actor: 'system:scout-src-smoothcomp', nowIso: '2027-01-02T00:00:00.000Z' });
  assert.equal(outcome, 'updated');
  assert.deepEqual(statements.map((s) => s.kind), ['update_content', 'review_log_edit']);
  assert.equal(statements[0].row.name, 'Fixture Open 2027');
});

test('an APPROVED row with real content changes demotes to needs_review FIRST, then updates -- content is locked while approved', () => {
  const existing = { ...DRAFT, id: 'evt-approved', status: 'approved', start_date: '2027-05-01' }; // date moved
  const { outcome, statements } = planEventUpsert({ existing, draft: DRAFT, actor: 'system:scout-src-smoothcomp', nowIso: '2027-01-02T00:00:00.000Z' });
  assert.equal(outcome, 'updated_and_demoted');
  assert.deepEqual(statements.map((s) => s.kind), ['review_log_transition', 'update_content', 'review_log_edit']);
  assert.equal(statements[0].from, 'approved');
  assert.equal(statements[0].to, 'needs_review');
});

test('an approved row with NO real content change is never demoted -- only re-seen, silently', () => {
  const existing = { ...DRAFT, id: 'evt-approved', status: 'approved' };
  const { outcome, statements } = planEventUpsert({ existing, draft: DRAFT, actor: 'system:scout-src-smoothcomp', nowIso: '2027-01-02T00:00:00.000Z' });
  assert.equal(outcome, 'unchanged');
  assert.equal(statements.length, 1);
  assert.equal(statements[0].kind, 'touch_last_seen');
});

test('review_log_edit records the real before/after content, not the whole row (no status/id churn in the audit payload)', () => {
  const existing = { ...DRAFT, id: 'evt-existing', status: 'needs_review', name: 'Old Name' };
  const { statements } = planEventUpsert({ existing, draft: DRAFT, actor: 'system:scout-src-smoothcomp', nowIso: '2027-01-02T00:00:00.000Z' });
  const edit = statements.find((s) => s.kind === 'review_log_edit');
  const before = JSON.parse(edit.beforeJson);
  const after = JSON.parse(edit.afterJson);
  assert.equal(before.name, 'Old Name');
  assert.equal(after.name, 'Fixture Open 2027');
  assert.ok(!('id' in before) && !('status' in before), 'the audit payload is content fields only');
});

test('a rejected row with real content changes still updates without demotion -- content is only locked while approved', () => {
  const existing = { ...DRAFT, id: 'evt-rejected', status: 'rejected', name: 'Old Name' };
  const { outcome, statements } = planEventUpsert({ existing, draft: DRAFT, actor: 'system:scout-src-smoothcomp', nowIso: '2027-01-02T00:00:00.000Z' });
  assert.equal(outcome, 'updated');
  assert.deepEqual(statements.map((s) => s.kind), ['update_content', 'review_log_edit']);
});
