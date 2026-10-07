// ALMANAC's first automatic approval rule, `tier1_listing_v1` (MAD v2.60,
// 2026-10-07; founder ruling 2026-10-05: "yes auto-approve future events
// following this criteria"). Until now every approval was a person's
// (MAD v2.54: "Automatic approval of model-extracted rows stays off until the
// founder reviews a measured precision number and rules on it in a dated
// amendment"). 278 decisions, no wrong row found; the amendment records that
// the founder set aside his own "until a wrong row has actually been seen".
//
// What this module does: once a night, after the crawl, it approves the
// waiting rows that pass EVERY deterministic check below, and nothing else.
// No model, no score, no judgment. Everything it does not approve stays for
// a person, exactly as before.
//
// The database is the final word, not this file: the review_log transition
// trigger refuses a system approval unless the named rule is enabled
// (core_schema.sql, "automatic approval is off"), so the kill switch
//   UPDATE approval_rules SET enabled = 0 WHERE id = 'tier1_listing_v1'
// stops every further approval even if this code keeps running. Rows it
// approved are found by approval_rule = 'tier1_listing_v1'.

export const RULE_ID = 'tier1_listing_v1';
export const ACTOR = 'system:auto-approve';
export const MAX_APPROVALS_PER_RUN = 300;
export const MAX_DAYS_OUT = 400;
export const STILL_LISTED_WITHIN_HOURS = 72;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const STATE_SOURCES = new Set(['scraped', 'derived']);

function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// The set-level checks, in SQL, so the candidate list is small. Every one
// of them is checked AGAIN in evaluateCandidate below, in code, against the
// row this returns -- the SQL narrows, the code decides.
//   ?1 today (UTC, YYYY-MM-DD)   ?2 last allowed start date
//   ?3 still-listed cutoff (ISO) ?4 row limit
export const CANDIDATES_SQL = `
  SELECT e.id, e.name, e.start_date, e.city, e.state, e.country, e.lat, e.lon,
         e.state_source, e.registration_url, e.source_host, e.source_tier, e.last_seen_at,
         sa.id AS alias_id, sa.robots_sha256 AS alias_robots_sha256,
         sa.robots_read_on AS alias_robots_read_on, sa.terms_verdict AS alias_terms_verdict,
         s.id AS source_id
  FROM events e
  JOIN source_aliases sa ON sa.host = e.source_host AND sa.active = 1
  JOIN sources s ON s.id = sa.source_id AND s.active = 1
  WHERE e.status = 'needs_review'
    AND e.country = 'US'
    AND e.source_tier = 1
    AND e.start_date > ?1
    AND e.start_date <= ?2
    AND e.lat IS NOT NULL AND e.lon IS NOT NULL
    AND e.state_source IN ('scraped', 'derived')
    AND e.registration_url LIKE 'https://' || e.source_host || '/%'
    AND e.last_seen_at >= ?3
    AND NOT EXISTS (
      SELECT 1 FROM review_log l
      WHERE l.entity_type = 'event' AND l.entity_id = e.id AND l.action = 'transition'
        AND l.actor NOT LIKE 'system:%' AND l.to_status IN ('needs_review', 'rejected')
    )
  ORDER BY e.start_date ASC, e.id ASC
  LIMIT ?4
`;

// Rows that could be the same event: same start date, city and state,
// approved or waiting, not this row. The name comparison happens in code
// (normalizeName), since SQLite has no regex replace.
export const SAME_DAY_AND_PLACE_SQL = `
  SELECT id, name FROM events
  WHERE status IN ('approved', 'needs_review') AND start_date = ?1
    AND lower(city) = lower(?2) AND state = ?3 AND id <> ?4
`;

// Case and punctuation never make two events different.
export function normalizeName(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Re-checks one candidate in code and builds the evidence for every check.
 * Pure: no database, no clock beyond `nowMs`.
 * @returns {{ pass: boolean, failures: string[], hoursSinceListed: number|null }}
 */
export function evaluateCandidate(row, { nowMs }) {
  const failures = [];
  const today = utcDay(nowMs);
  const lastDay = utcDay(nowMs + MAX_DAYS_OUT * DAY_MS);

  if (row.country !== 'US') failures.push('not in the United States');
  if (row.source_tier !== 1) failures.push('not a Tier 1 row');
  if (!(typeof row.start_date === 'string' && row.start_date > today && row.start_date <= lastDay)) {
    failures.push(`start date ${row.start_date} is not after today and within ${MAX_DAYS_OUT} days`);
  }
  const lat = Number(row.lat);
  const lon = Number(row.lon);
  if (row.lat == null || row.lon == null || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    failures.push('coordinates are missing or out of range');
  }
  if (!STATE_SOURCES.has(row.state_source)) failures.push('state was not established by the crawl');
  if (typeof row.registration_url !== 'string' || !row.source_host || !row.registration_url.startsWith(`https://${row.source_host}/`)) {
    failures.push("registration link is not https on the organizer's own host");
  }
  const seenMs = Date.parse(row.last_seen_at);
  const hoursSinceListed = Number.isFinite(seenMs) ? (nowMs - seenMs) / HOUR_MS : null;
  if (hoursSinceListed === null || hoursSinceListed < 0 || hoursSinceListed > STILL_LISTED_WITHIN_HOURS) {
    failures.push(`not seen on the organizer's listing within ${STILL_LISTED_WITHIN_HOURS} hours`);
  }
  if (!row.alias_id || !row.source_id) failures.push('no active, terms-reviewed organizer alias');

  return { pass: failures.length === 0, failures, hoursSinceListed };
}

/**
 * The five signals one approval records (MAD v2.54: "every row it approves
 * carries its recorded verification signals"). The link signal carries NO
 * pass mark: these event pages refuse plain HTTP, so freshness is the
 * organizer's own listing, recorded as structural and never as live
 * (MAD v2.60, decision zero).
 */
export function signalsFor(row, { nowIso, today, hoursSinceListed, sameDayRowsChecked }) {
  return [
    { signal: 'date_sane', value_num: null, passed: 1, evidence: { start_date: row.start_date, today, max_days_out: MAX_DAYS_OUT } },
    { signal: 'geocode_confidence', value_num: null, passed: 1, evidence: { state: row.state, state_source: row.state_source, lat: Number(row.lat), lon: Number(row.lon) } },
    { signal: 'robots_allowed', value_num: null, passed: 1, evidence: { host: row.source_host, alias_id: row.alias_id, source_id: row.source_id, terms_verdict: row.alias_terms_verdict, robots_sha256: row.alias_robots_sha256, robots_read_on: row.alias_robots_read_on } },
    { signal: 'duplicate_score', value_num: 0, passed: 1, evidence: { checked: 'same start date, city and state, name ignoring case and punctuation', rows_compared: sameDayRowsChecked, matches: 0 } },
    { signal: 'link_live', value_num: Math.round(hoursSinceListed * 10) / 10, passed: null, evidence: { method: 'structural', registration_url: row.registration_url, listing_last_seen_at: row.last_seen_at, why: 'the event page refuses plain HTTP; freshness is the organizer listing (MAD v2.60)' } },
  ].map((s) => ({ ...s, checked_at: nowIso }));
}

/**
 * One nightly pass. `db` is a D1 binding (or a fake with the same shape).
 * @returns {Promise<{ruleEnabled: boolean, considered: number, approved: number, held: Array<{id:string,name:string,reason:string}>}>}
 */
export async function runAutoApprove({ db, now, maxApprovals = MAX_APPROVALS_PER_RUN }) {
  const rule = await db.prepare('SELECT enabled FROM approval_rules WHERE id = ?1').bind(RULE_ID).first();
  if (!rule || rule.enabled !== 1) {
    return { ruleEnabled: false, considered: 0, approved: 0, held: [] };
  }

  const nowIso = new Date(now).toISOString();
  const today = utcDay(now);
  const lastDay = utcDay(now + MAX_DAYS_OUT * DAY_MS);
  const listedSince = new Date(now - STILL_LISTED_WITHIN_HOURS * HOUR_MS).toISOString();
  const { results: candidates } = await db.prepare(CANDIDATES_SQL).bind(today, lastDay, listedSince, maxApprovals).all();

  let approved = 0;
  const held = [];
  for (const row of candidates) {
    const verdict = evaluateCandidate(row, { nowMs: now });
    if (!verdict.pass) {
      held.push({ id: row.id, name: row.name, reason: verdict.failures.join('; ') });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- one small read per candidate
    const { results: sameDay } = await db.prepare(SAME_DAY_AND_PLACE_SQL).bind(row.start_date, row.city, row.state, row.id).all();
    const mine = normalizeName(row.name);
    const twin = sameDay.find((other) => normalizeName(other.name) === mine);
    if (twin) {
      held.push({ id: row.id, name: row.name, reason: `possible duplicate of ${twin.id}` });
      continue;
    }

    const signals = signalsFor(row, { nowIso, today, hoursSinceListed: verdict.hoursSinceListed, sameDayRowsChecked: sameDay.length });
    const statements = signals.map((s) =>
      db
        .prepare('INSERT INTO row_signals (entity_type, entity_id, signal, value_num, passed, evidence, checked_at) VALUES (\'event\', ?1, ?2, ?3, ?4, ?5, ?6)')
        .bind(row.id, s.signal, s.value_num, s.passed, JSON.stringify(s.evidence), s.checked_at),
    );
    // The structural link verdict, the same one the nightly link check
    // records for every approved listing row, so the row carries a check
    // from the moment it is approved.
    statements.push(
      db.prepare("UPDATE events SET link_checked_at = ?1, link_check_method = 'structural' WHERE id = ?2").bind(nowIso, row.id),
    );
    // Last in the batch: if the rule was switched off a moment ago, the
    // trigger refuses this and the whole batch (signals included) rolls back.
    statements.push(
      db
        .prepare("INSERT INTO review_log (entity_type, entity_id, action, from_status, to_status, actor, approval_rule, after_json) VALUES ('event', ?1, 'transition', 'needs_review', 'approved', ?2, ?3, ?4)")
        .bind(row.id, ACTOR, RULE_ID, JSON.stringify({ rule: RULE_ID, amendment: 'MAD v2.60', signals: signals.map((s) => s.signal) })),
    );
    // eslint-disable-next-line no-await-in-loop -- one atomic batch per row
    await db.batch(statements);
    approved += 1;
  }

  return { ruleEnabled: true, considered: candidates.length, approved, held };
}
