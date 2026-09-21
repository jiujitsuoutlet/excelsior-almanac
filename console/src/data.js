// D1 access for the ALMANAC console. Every status change is an INSERT into
// review_log with action = 'transition'; the database applies it (schema rule 1).

import {
  precisionByHost,
  inFootprint,
  footprintHeadline,
  REJECT_REASONS, EDITABLE_FIELDS, chipsFor, duplicateState, approvalEligibility,
  dedupeKey, hostOf, queueHeadline, weekdayDate, daysUntil, approvalBlockers,
} from './lib.js';

export class ConsoleError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const today = () => new Date().toISOString().slice(0, 10);

// Messages raised by the schema's triggers, surfaced to the reviewer as-is.
const TRIGGER_MESSAGES = [
  'status changes only through a review_log transition', 'transition is not allowed',
  'does not match the current status', 'not an active reviewer', 'automatic approval is off',
  'applies only to automatic approvals', 'system actors cannot make this transition',
  'approved content is locked', 'already exists; update it instead', 'never deleted',
  'append-only', 'ids never change', 'new rows start as draft',
];

// Database rules stated in the reviewer's words. Anything not listed still
// shows its rule text, never a bare "check constraint".
const CHECK_MESSAGES = {
  "status <> 'approved' OR registration_url IS NOT NULL":
    'An approved event must have a registration link (https). Press E to add it, or R then 4 to reject it.',
  "(status = 'approved') = (approved_at IS NOT NULL)":
    'Approval time and status disagree; reload the row and try again.',
  'enabled = 0 OR amendment_ref IS NOT NULL':
    'An automatic approval rule cannot be switched on without an amendment reference.',
};

export function translateDbError(err) {
  const message = String(err?.message ?? err);
  // A trigger refusal already reads as a sentence. Return the whole sentence,
  // not the fragment matched on.
  const raised = message.match(/(?:D1_ERROR:\s*)?(.+?): SQLITE_CONSTRAINT/);
  const sentence = raised?.[1]?.trim();
  if (sentence && TRIGGER_MESSAGES.some((m) => sentence.includes(m))) return new ConsoleError(409, sentence);
  if (message.includes('UNIQUE constraint failed')) return new ConsoleError(409, 'A matching row already exists');
  const check = message.match(/CHECK constraint failed: ([^:]+)/);
  if (check) {
    const expression = check[1].trim();
    const friendly = CHECK_MESSAGES[expression];
    return new ConsoleError(
      friendly ? 409 : 400,
      friendly ?? `This change broke a database rule the console has no plain-English message for yet. Rule: ${expression}. Send this line to the build session.`,
    );
  }
  if (message.includes('FOREIGN KEY constraint failed')) return new ConsoleError(400, 'A referenced row does not exist');
  return null;
}

async function run(db, statements) {
  try {
    return await db.batch(statements);
  } catch (err) {
    throw translateDbError(err) ?? err;
  }
}

export async function getMarker(db) {
  const row = await db.prepare('SELECT name FROM environment_marker WHERE id = 1').first();
  return row?.name ?? null;
}

export async function getReviewer(db, email) {
  return db.prepare('SELECT email, role, active FROM reviewers WHERE email = ?1').bind(email).first();
}

export async function statusStrip(db) {
  const row = await db.prepare(`
    SELECT
      (SELECT count(*) FROM events WHERE status = 'needs_review') AS needs_review,
      (SELECT count(*) FROM events WHERE status = 'approved' AND start_date >= ?1) AS approved_upcoming,
      (SELECT count(*) FROM events WHERE status = 'stale') AS stale,
      (SELECT count(*) FROM review_log WHERE action = 'transition' AND to_status = 'rejected'
         AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')) AS rejected_this_week
  `).bind(today()).first();
  const lastRun = await db.prepare(
    "SELECT component, status, started_at, finished_at FROM crawl_runs WHERE component LIKE '%scout' ORDER BY started_at DESC LIMIT 1",
  ).first();
  return { ...row, last_scout_run: lastRun ?? null };
}

// Human decisions on scout-created (Tier 1/2) rows, per host. Machine
// actors ('system:...') never count: this measures what a person made of
// the scout's output, not what the scout did. A row counts once per
// decision direction however many times it was re-reviewed.
export async function scoutPrecision(db) {
  const { results } = await db.prepare(`
    SELECT e.source_host AS source_host, rl.to_status AS decision, count(DISTINCT e.id) AS n
    FROM review_log rl JOIN events e ON e.id = rl.entity_id
    WHERE rl.entity_type = 'event' AND rl.action = 'transition'
      AND rl.from_status = 'needs_review' AND rl.to_status IN ('approved', 'rejected')
      AND e.source_tier IN (1, 2) AND rl.actor NOT LIKE 'system:%'
    GROUP BY e.source_host, rl.to_status
  `).all();
  return precisionByHost(results);
}

// The queue: rows waiting for review, grouped by host. Groups are ordered by
// their soonest event; inside a group, soonest date first, then highest confidence.
export async function queue(db) {
  const { results } = await db.prepare(`
    SELECT id, name, start_date, city, state, country, source_host, source_tier, confidence
    FROM events WHERE status = 'needs_review'
  `).all();
  const groups = new Map();
  for (const r of results) {
    if (!groups.has(r.source_host)) groups.set(r.source_host, []);
    groups.get(r.source_host).push(r);
  }
  const byRow = (a, b) => a.start_date.localeCompare(b.start_date) || (b.confidence ?? -1) - (a.confidence ?? -1) || a.id.localeCompare(b.id);
  const grouped = [...groups.values()]
    .map((rows) => rows.sort(byRow))
    .sort((a, b) => a[0].start_date.localeCompare(b[0].start_date) || a[0].source_host.localeCompare(b[0].source_host))
    .flat();
  // Footprint first (founder ruling, 2026-09-20: "sort my queue so the
  // Missouri-and-bordering rows come first... that is my first review
  // session, not all 269"). Everything else keeps its existing order and
  // follows; nothing is hidden or dropped.
  const footprint = grouped.filter(inFootprint);
  const rest = grouped.filter((r) => !inFootprint(r));
  const ordered = [...footprint, ...rest];
  return {
    rows: ordered,
    footprint_count: footprint.length,
    headline: footprintHeadline(footprint.length, ordered.length),
    total_headline: queueHeadline(ordered.length),
  };
}

async function signalsFor(db, id) {
  const { results } = await db.prepare(
    "SELECT id, signal, value_num, passed, evidence, checked_at FROM row_signals WHERE entity_type = 'event' AND entity_id = ?1 ORDER BY id",
  ).bind(id).all();
  return results.map((s) => ({ ...s, evidence: s.evidence ? JSON.parse(s.evidence) : null }));
}

async function candidatesFor(db, event) {
  const { results } = await db.prepare(`
    SELECT id, name, start_date, city, state, status FROM events
    WHERE id <> ?1 AND status <> 'rejected' AND country = ?2 AND state = ?3
      AND abs(julianday(start_date) - julianday(?4)) <= 1
    ORDER BY start_date LIMIT 10
  `).bind(event.id, event.country, event.state, event.start_date).all();
  return results;
}

export async function rowDetail(db, id) {
  const event = await db.prepare('SELECT * FROM events WHERE id = ?1').bind(id).first();
  if (!event) throw new ConsoleError(404, 'Row not found');
  const signals = await signalsFor(db, id);
  const chips = chipsFor(event, signals);
  const duplicates = duplicateState(event, await candidatesFor(db, event), signals);
  const eligibility = approvalEligibility(chips, duplicates, event);
  return {
    event,
    display: { start: weekdayDate(event.start_date), end: event.end_date ? weekdayDate(event.end_date) : null, days_until: daysUntil(event.start_date, today()) },
    chips,
    duplicates,
    eligibility,
    signals: {
      link_live: signals.filter((s) => s.signal === 'link_live').at(-1) ?? null,
      geocode_confidence: event.geocode_confidence,
    },
  };
}

async function requireStatus(db, id, expected) {
  const row = await db.prepare('SELECT status FROM events WHERE id = ?1').bind(id).first();
  if (!row) throw new ConsoleError(404, 'Row not found');
  if (row.status !== expected) throw new ConsoleError(409, `Row is ${row.status}, not ${expected}`);
}

function transition(db, id, from, to, actor, reasonCode = null) {
  return db.prepare(`
    INSERT INTO review_log (entity_type, entity_id, action, from_status, to_status, actor, reason_code)
    VALUES ('event', ?1, 'transition', ?2, ?3, ?4, ?5)
  `).bind(id, from, to, actor, reasonCode);
}

export async function decide(db, id, body, actor) {
  await requireStatus(db, id, 'needs_review');
  if (body.decision === 'approve') {
    const detail = await rowDetail(db, id);
    const blockers = detail.eligibility.blockers;
    if (blockers.length > 0) {
      throw new ConsoleError(409, `${blockers[0].message} ${blockers[0].fix}`, { blockers });
    }
    if (!detail.eligibility.plain && body.deliberate !== true) {
      throw new ConsoleError(409, 'Deliberate approval required (Shift+A)', { reasons: detail.eligibility.reasons });
    }
    await run(db, [transition(db, id, 'needs_review', 'approved', actor)]);
    return { status: 'approved' };
  }
  if (body.decision === 'reject') {
    const reason = REJECT_REASONS[body.reason];
    if (!reason) throw new ConsoleError(400, 'Choose a reject reason, 1 to 6');
    await run(db, [transition(db, id, 'needs_review', 'rejected', actor, reason.code)]);
    return { status: 'rejected', reason: reason.code };
  }
  throw new ConsoleError(400, 'Unknown decision');
}

export async function resolveDuplicate(db, id, body, actor) {
  await requireStatus(db, id, 'needs_review');
  const detail = await rowDetail(db, id);
  if (body.action === 'distinct') {
    const ids = detail.duplicates.candidates.map((c) => c.id);
    if (ids.length === 0) throw new ConsoleError(409, 'No possible duplicates to clear');
    await run(db, [db.prepare(`
      INSERT INTO row_signals (entity_type, entity_id, signal, passed, evidence)
      VALUES ('event', ?1, 'duplicate_score', 1, ?2)
    `).bind(id, JSON.stringify({ resolved: 'distinct', candidate_ids: ids, by: actor }))]);
    return { status: 'needs_review', cleared: ids };
  }
  if (body.action === 'merge') {
    const target = detail.duplicates.candidates.find((c) => c.id === body.into);
    if (!target) throw new ConsoleError(400, 'Merge target is not a candidate for this row');
    await run(db, [
      db.prepare(`
        INSERT INTO review_log (entity_type, entity_id, action, actor, merged_into_id)
        VALUES ('event', ?1, 'merge', ?2, ?3)
      `).bind(id, actor, target.id),
      transition(db, id, 'needs_review', 'rejected', actor, 'duplicate'),
    ]);
    return { status: 'rejected', merged_into: target.id };
  }
  throw new ConsoleError(400, 'Unknown duplicate action');
}

export async function editEvent(db, id, patch, actor, validated) {
  const before = await db.prepare('SELECT * FROM events WHERE id = ?1').bind(id).first();
  if (!before) throw new ConsoleError(404, 'Row not found');
  if (before.status !== 'needs_review') throw new ConsoleError(409, `Only rows waiting for review can be edited here (this row is ${before.status})`);
  const fields = Object.keys(validated).filter((f) => EDITABLE_FIELDS.includes(f) && validated[f] !== before[f]);
  if (fields.length === 0) return { changed: [] };
  const after = { ...before, ...Object.fromEntries(fields.map((f) => [f, validated[f]])) };
  const assignments = fields.map((f, i) => `${f} = ?${i + 1}`).join(', ');
  const params = fields.map((f) => validated[f]);
  await run(db, [
    db.prepare(`UPDATE events SET ${assignments}, dedupe_key = ?${fields.length + 1}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?${fields.length + 2}`)
      .bind(...params, dedupeKey(after), id),
    db.prepare(`
      INSERT INTO review_log (entity_type, entity_id, action, actor, before_json, after_json)
      VALUES ('event', ?1, 'edit', ?2, ?3, ?4)
    `).bind(id, actor, JSON.stringify(pick(before, fields)), JSON.stringify(pick(after, fields))),
  ]);
  return { changed: fields };
}

function pick(obj, fields) {
  return Object.fromEntries(fields.map((f) => [f, obj[f]]));
}

export async function addEvent(db, value, actor, geocode) {
  const id = crypto.randomUUID();
  const event = {
    id,
    event_type: value.event_type,
    name: value.name,
    organizer_name: value.organizer_name ?? null,
    start_date: value.start_date,
    end_date: value.end_date ?? null,
    venue_name: value.venue_name ?? null,
    address: value.address ?? null,
    city: value.city,
    state: value.state,
    country: value.country,
    registration_url: value.registration_url ?? null,
    registration_deadline: value.registration_deadline ?? null,
    gi: value.gi ?? 0,
    nogi: value.nogi ?? 0,
    kids: value.kids ?? 0,
    source_url: value.source_url,
    source_host: hostOf(value.source_url),
    source_tier: 3,
    lat: geocode?.lat ?? null,
    lon: geocode?.lon ?? null,
    geocode_confidence: geocode?.confidence ?? null,
  };
  event.dedupe_key = dedupeKey(event);
  const cols = Object.keys(event);
  await run(db, [
    db.prepare(`INSERT INTO events (${cols.join(', ')}) VALUES (${cols.map((_, i) => `?${i + 1}`).join(', ')})`)
      .bind(...cols.map((c) => event[c])),
    db.prepare(`
      INSERT INTO review_log (entity_type, entity_id, action, actor, after_json)
      VALUES ('event', ?1, 'create', ?2, ?3)
    `).bind(id, actor, JSON.stringify({ source: 'console hand entry', geocoded: Boolean(geocode) })),
    transition(db, id, 'draft', 'needs_review', actor),
  ]);
  return { id, status: 'needs_review', geocoded: Boolean(geocode) };
}

export async function recentDecisions(db, actor) {
  const { results } = await db.prepare(`
    SELECT l.id, l.entity_id, l.to_status, l.reason_code, l.created_at, e.name, e.status AS current_status,
           (SELECT max(x.id) FROM review_log x
             WHERE x.entity_type = 'event' AND x.entity_id = l.entity_id AND x.action = 'transition') AS latest_transition_id
    FROM review_log l JOIN events e ON e.id = l.entity_id
    WHERE l.entity_type = 'event' AND l.action = 'transition' AND l.actor = ?1
      AND l.to_status IN ('approved', 'rejected')
    ORDER BY l.id DESC LIMIT 5
  `).bind(actor).all();
  return results.map((r) => ({
    log_id: r.id,
    event_id: r.entity_id,
    name: r.name,
    decision: r.to_status,
    reason: r.reason_code,
    at: r.created_at,
    undoable: r.latest_transition_id === r.id && r.current_status === r.to_status,
  }));
}

export async function undoDecision(db, logId, actor) {
  const log = await db.prepare(
    "SELECT id, entity_id, to_status, actor FROM review_log WHERE id = ?1 AND entity_type = 'event' AND action = 'transition'",
  ).bind(logId).first();
  if (!log) throw new ConsoleError(404, 'Decision not found');
  if (log.actor !== actor) throw new ConsoleError(403, 'You can only undo your own decisions');
  if (!['approved', 'rejected'].includes(log.to_status)) throw new ConsoleError(400, 'Only approvals and rejections can be undone');
  const recent = await recentDecisions(db, actor);
  const item = recent.find((r) => r.log_id === log.id);
  if (!item) throw new ConsoleError(409, 'Only your last five decisions can be undone');
  if (!item.undoable) throw new ConsoleError(409, 'This row has moved on since that decision; open it instead');
  await run(db, [transition(db, log.entity_id, log.to_status, 'needs_review', actor)]);
  return { event_id: log.entity_id, status: 'needs_review' };
}
