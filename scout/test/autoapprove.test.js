// MAD v2.60: the first automatic approval rule, `tier1_listing_v1`.
// Two kinds of proof. Pure: every check fails a row on its own. Real: the
// whole migrations/ folder applied to an in-memory SQLite database (Node's
// own node:sqlite), so the database's OWN triggers -- not a fake -- accept a
// rule approval, refuse one when the rule is off, and roll a refused batch
// back whole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  evaluateCandidate,
  normalizeName,
  runAutoApprove,
  signalsFor,
  RULE_ID,
  MAX_DAYS_OUT,
  STILL_LISTED_WITHIN_HOURS,
} from '../src/autoapprove.js';

const NOW = Date.parse('2026-10-07T07:10:00.000Z');
const HOUR = 60 * 60 * 1000;

function candidate(overrides = {}) {
  return {
    id: 'evt-a',
    name: 'NAGA Kansas City Grappling Championship',
    start_date: '2026-11-14',
    city: 'Kansas City',
    state: 'MO',
    country: 'US',
    lat: 39.0997,
    lon: -94.5786,
    state_source: 'derived',
    registration_url: 'https://naga.smoothcomp.com/en/event/12345',
    source_host: 'naga.smoothcomp.com',
    source_tier: 1,
    last_seen_at: new Date(NOW - 3 * HOUR).toISOString(),
    alias_id: 'alias-naga',
    source_id: 'src-smoothcomp',
    alias_terms_verdict: 'inherited_parent',
    alias_robots_sha256: 'a'.repeat(64),
    alias_robots_read_on: '2026-10-07',
    ...overrides,
  };
}

test('a row that passes every check passes', () => {
  const v = evaluateCandidate(candidate(), { nowMs: NOW });
  assert.equal(v.pass, true, v.failures.join('; '));
  assert.equal(Math.round(v.hoursSinceListed), 3);
});

test('each check fails a row on its own', () => {
  const cases = [
    [{ country: 'CA' }, /United States/],
    [{ source_tier: 2 }, /Tier 1/],
    [{ start_date: '2026-10-07' }, /start date/], // today is not "after today"
    [{ start_date: '2026-10-01' }, /start date/],
    [{ start_date: '2027-12-31' }, /start date/], // past MAX_DAYS_OUT
    [{ lat: null }, /coordinates/],
    [{ lon: 999 }, /coordinates/],
    [{ state_source: null }, /state/],
    [{ registration_url: 'http://naga.smoothcomp.com/en/event/12345' }, /https/],
    [{ registration_url: 'https://evil.example/naga.smoothcomp.com/' }, /organizer's own host/],
    [{ last_seen_at: new Date(NOW - (STILL_LISTED_WITHIN_HOURS + 1) * HOUR).toISOString() }, /listing/],
    [{ last_seen_at: 'not a date' }, /listing/],
    [{ alias_id: null }, /organizer alias/],
  ];
  for (const [overrides, pattern] of cases) {
    const v = evaluateCandidate(candidate(overrides), { nowMs: NOW });
    assert.equal(v.pass, false, `should fail: ${JSON.stringify(overrides)}`);
    assert.equal(v.failures.length, 1, `exactly one failure for ${JSON.stringify(overrides)}: ${v.failures}`);
    assert.match(v.failures[0], pattern);
  }
  assert.ok(MAX_DAYS_OUT === 400);
});

test('names compare without case or punctuation', () => {
  assert.equal(normalizeName('NAGA  Kansas-City Grappling Championship!'), normalizeName('naga kansas city grappling championship'));
  assert.notEqual(normalizeName('NAGA Kansas City Open'), normalizeName('NAGA Kansas City Championship'));
});

test('the link signal never claims a live check', () => {
  const signals = signalsFor(candidate(), { nowIso: new Date(NOW).toISOString(), today: '2026-10-07', hoursSinceListed: 3.04, sameDayRowsChecked: 0 });
  assert.deepEqual(signals.map((s) => s.signal), ['date_sane', 'geocode_confidence', 'robots_allowed', 'duplicate_score', 'link_live']);
  const link = signals.find((s) => s.signal === 'link_live');
  assert.equal(link.passed, null, 'no pass mark: the event page refuses plain HTTP, so nothing was checked live');
  assert.equal(link.value_num, 3);
  assert.equal(link.evidence.method, 'structural');
});

// ---------- real database: every migration, every trigger ----------

function d1Over(sqlite) {
  const make = (sql) => {
    let args = [];
    const api = {
      bind(...a) { args = a; return api; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async run() { sqlite.prepare(sql).run(...args); return { success: true }; },
      exec() { return sqlite.prepare(sql).run(...args); },
    };
    return api;
  };
  return {
    prepare: make,
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        for (const s of statements) s.exec();
        sqlite.exec('COMMIT');
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

function freshDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  const dir = new URL('../../migrations/', import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(file, dir), 'utf8'));
  }
  sqlite.exec(`
    INSERT INTO reviewers (email, role) VALUES ('founder@example.com', 'admin');
    INSERT INTO sources (id, host, tier, page_types, terms_url, terms_last_updated, terms_read_on,
      terms_automated_access, terms_reuse, login_required, official_api, excluded_paths, robots_disallowed,
      robots_sha256, robots_read_on, verdict, verdict_conditions, reviewed_by, reviewed_on, active, crawl_mode)
    VALUES ('src-smoothcomp', 'smoothcomp.com', 1, 'listing', 'https://smoothcomp.com/en/agreements', 'not stated', '2026-09-16',
      'none found', 'none found', 0, 'none', '[]', '[]', '${'b'.repeat(64)}', '2026-09-16', 'allowed_with_conditions',
      'listing pages only', 'founder@example.com', '2026-09-16', 1, 'listing_only');
    INSERT INTO source_aliases (id, source_id, host, listing_path, added_by, added_on, robots_sha256, robots_read_on,
      organizer_terms_url, organizer_terms_checked_on, active, terms_verdict, terms_reasoning)
    VALUES ('alias-naga', 'src-smoothcomp', 'naga.smoothcomp.com', '/en/federation/32/events/upcoming', 'founder@example.com',
      '2026-09-21', '${'b'.repeat(64)}', '2026-10-07', NULL, '2026-09-21', 1, 'inherited_parent', 'test fixture');
  `);
  return sqlite;
}

function waitingEvent(sqlite, row) {
  const r = { ...candidate(), ...row };
  sqlite.prepare(`INSERT INTO events (id, event_type, name, start_date, city, state, country, lat, lon, registration_url,
      source_url, source_host, source_tier, state_source, link_check_method, dedupe_key, last_seen_at)
    VALUES (?1, 'tournament', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10, 1, ?11, 'structural', ?12, ?13)`)
    .run(r.id, r.name, r.start_date, r.city, r.state, r.country, r.lat, r.lon, r.registration_url, r.source_host, r.state_source, `${r.id}-key`, r.last_seen_at);
  sqlite.prepare(`INSERT INTO review_log (entity_type, entity_id, action, from_status, to_status, actor) VALUES ('event', ?1, 'transition', 'draft', 'needs_review', 'system:scout-src-smoothcomp')`).run(r.id);
}

test('real database: the migration enables the rule, citing its amendment', () => {
  const sqlite = freshDatabase();
  assert.deepEqual({ ...sqlite.prepare('SELECT id, tier, enabled, amendment_ref FROM approval_rules').get() }, { id: RULE_ID, tier: 1, enabled: 1, amendment_ref: 'MAD v2.60' });
});

test('real database: a passing row is approved by the rule, with its five signals, in one batch', async () => {
  const sqlite = freshDatabase();
  waitingEvent(sqlite, { id: 'evt-ok' });
  waitingEvent(sqlite, { id: 'evt-canada', country: 'CA', name: 'Toronto Open', city: 'Toronto', state: 'ON', lat: 43.65, lon: -79.38 });
  const result = await runAutoApprove({ db: d1Over(sqlite), now: NOW });
  assert.equal(result.ruleEnabled, true);
  assert.equal(result.approved, 1);
  const ev = sqlite.prepare("SELECT status, approval_rule, approved_by, link_check_method, link_checked_at FROM events WHERE id = 'evt-ok'").get();
  assert.equal(ev.status, 'approved');
  assert.equal(ev.approval_rule, RULE_ID);
  assert.equal(ev.approved_by, null, 'a rule approval names the rule, never a person');
  assert.equal(ev.link_check_method, 'structural');
  assert.ok(ev.link_checked_at);
  const signals = sqlite.prepare("SELECT signal FROM row_signals WHERE entity_id = 'evt-ok' ORDER BY id").all().map((r) => r.signal);
  assert.deepEqual(signals, ['date_sane', 'geocode_confidence', 'robots_allowed', 'duplicate_score', 'link_live']);
  const log = sqlite.prepare("SELECT actor, approval_rule FROM review_log WHERE entity_id = 'evt-ok' AND to_status = 'approved'").get();
  assert.equal(log.actor, 'system:auto-approve');
  assert.equal(sqlite.prepare("SELECT status FROM events WHERE id = 'evt-canada'").get().status, 'needs_review', 'outside the US stays for a person');
});

test('real database: the kill switch stops it, and a refused batch rolls back whole', async () => {
  const sqlite = freshDatabase();
  waitingEvent(sqlite, { id: 'evt-ok' });
  sqlite.exec(`UPDATE approval_rules SET enabled = 0 WHERE id = '${RULE_ID}'`);
  const off = await runAutoApprove({ db: d1Over(sqlite), now: NOW });
  assert.equal(off.ruleEnabled, false);
  assert.equal(off.approved, 0);
  assert.equal(sqlite.prepare("SELECT status FROM events WHERE id = 'evt-ok'").get().status, 'needs_review');

  // Switched off between the enabled-check and the write: the trigger
  // itself refuses, and nothing from that row's batch survives.
  sqlite.exec(`UPDATE approval_rules SET enabled = 1 WHERE id = '${RULE_ID}'`);
  const db = d1Over(sqlite);
  const racing = {
    ...db,
    async batch(statements) {
      sqlite.exec(`UPDATE approval_rules SET enabled = 0 WHERE id = '${RULE_ID}'`);
      return db.batch(statements);
    },
  };
  await assert.rejects(runAutoApprove({ db: racing, now: NOW }), /automatic approval is off/);
  assert.equal(sqlite.prepare("SELECT status FROM events WHERE id = 'evt-ok'").get().status, 'needs_review');
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM row_signals WHERE entity_id = 'evt-ok'").get().n, 0, 'no orphan signals');
});

test('real database: possible duplicates and rows a person sent back stay for a person', async () => {
  const sqlite = freshDatabase();
  waitingEvent(sqlite, { id: 'evt-one', name: 'NAGA Kansas City Championship' });
  waitingEvent(sqlite, { id: 'evt-two', name: 'naga kansas-city championship', registration_url: 'https://naga.smoothcomp.com/en/event/999' });
  waitingEvent(sqlite, { id: 'evt-sent-back', name: 'Another Open', start_date: '2026-12-05' });
  // A person approves it, then sends it back to review.
  sqlite.exec(`
    INSERT INTO review_log (entity_type, entity_id, action, from_status, to_status, actor) VALUES ('event', 'evt-sent-back', 'transition', 'needs_review', 'approved', 'founder@example.com');
    INSERT INTO review_log (entity_type, entity_id, action, from_status, to_status, actor) VALUES ('event', 'evt-sent-back', 'transition', 'approved', 'needs_review', 'founder@example.com');
  `);
  const result = await runAutoApprove({ db: d1Over(sqlite), now: NOW });
  assert.equal(result.approved, 0);
  assert.deepEqual(result.held.map((h) => h.id).sort(), ['evt-one', 'evt-two']);
  for (const id of ['evt-one', 'evt-two', 'evt-sent-back']) {
    assert.equal(sqlite.prepare('SELECT status FROM events WHERE id = ?').get(id).status, 'needs_review', id);
  }
});

test('real database: at most the per-run cap', async () => {
  const sqlite = freshDatabase();
  for (let i = 0; i < 5; i++) waitingEvent(sqlite, { id: `evt-${i}`, name: `Open ${i}`, start_date: `2026-11-1${i}` });
  const result = await runAutoApprove({ db: d1Over(sqlite), now: NOW, maxApprovals: 3 });
  assert.equal(result.approved, 3);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM events WHERE status = 'needs_review'").get().n, 2, 'the rest wait for the next run');
});
