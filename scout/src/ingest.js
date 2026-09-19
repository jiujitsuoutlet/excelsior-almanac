// Phase 2 of the real crawl (founder ruling, 2026-09-19): work the
// discovered_pages queue down, oldest first, fetching each detail page
// (rate-limited per company, exactly like discovery), parsing it, and
// writing a real, trigger-respecting row into `events`.
//
// planEventUpsert() is the pure decision: given what (if anything)
// already exists for this event and what was just parsed, exactly which
// statements need to run. applyEventUpsert() is the thin, separately-
// testable adapter that turns those statements into real D1 calls. This
// split is the same seam queue.js/run.js already use -- the DECISION is
// unit-testable with no database; only the ADAPTER touches D1's actual
// API shape.

import { checkSource } from './gate.js';
import { groundPage } from './grounding.js';
import { fetchOnce, FetchRefused } from './fetcher.js';
import * as smoothcomp from './parsers/smoothcomp.js';

export const PARSERS = { 'src-smoothcomp': smoothcomp };

// The content fields `events_approved_content_lock` guards, word for
// word from the migration. last_seen_at/link_checked_at/updated_at are
// deliberately excluded: they are freshness bookkeeping, never locked.
const CONTENT_FIELDS = [
  'event_type', 'name', 'organizer_name', 'start_date', 'end_date',
  'venue_name', 'address', 'city', 'state', 'country',
  'registration_url', 'registration_deadline', 'gi', 'nogi', 'kids', 'source_url',
];

function pick(obj, fields) {
  return Object.fromEntries(fields.map((f) => [f, obj[f]]));
}

/**
 * Pure. `existing` is the current `events` row for this
 * (source_host, source_event_ref) or dedupe_key, or null if this event
 * has never been seen before. `draft` is a fresh parser.toDraftRow()
 * result. `actor` must be 'system:scout-<component>' (review_log's own
 * CHECK: a reviewer email, or 'system:<component>').
 *
 * Returns { outcome, statements }, where each statement is a plain,
 * descriptive object -- never a prepared D1 statement -- so this
 * function needs no database to test.
 */
export function planEventUpsert({ existing, draft, actor, nowIso }) {
  if (!existing) {
    return {
      outcome: 'inserted',
      statements: [
        { kind: 'insert_event', row: draft },
        { kind: 'review_log_create', entityId: draft.id, actor, afterJson: JSON.stringify({ source: `scout:${draft.source_host}` }) },
        { kind: 'review_log_transition', entityId: draft.id, from: 'draft', to: 'needs_review', actor },
      ],
    };
  }

  const changed = CONTENT_FIELDS.some((f) => existing[f] !== draft[f]);
  if (!changed) {
    return { outcome: 'unchanged', statements: [{ kind: 'touch_last_seen', id: existing.id, nowIso }] };
  }

  const statements = [];
  if (existing.status === 'approved') {
    // Approved content is locked by events_approved_content_lock; demote
    // first (system_allowed=1 for approved -> needs_review), same
    // philosophy as the Supabase side's tournaments_demote_on_edit --
    // a re-crawl finding real changes on a published row means it needs
    // a human's eyes again, not a silent overwrite.
    statements.push({ kind: 'review_log_transition', entityId: existing.id, from: 'approved', to: 'needs_review', actor });
  }
  statements.push({ kind: 'update_content', id: existing.id, row: draft, nowIso });
  statements.push({
    kind: 'review_log_edit',
    entityId: existing.id,
    actor,
    beforeJson: JSON.stringify(pick(existing, CONTENT_FIELDS)),
    afterJson: JSON.stringify(pick(draft, CONTENT_FIELDS)),
  });
  return { outcome: existing.status === 'approved' ? 'updated_and_demoted' : 'updated', statements };
}

// The real D1 adapter. One db.batch() call per event -- atomic, and
// short enough (2-4 statements) to stay well inside D1's own batch
// limits.
export async function applyEventUpsert(db, statements) {
  const stmts = statements.map((s) => {
    switch (s.kind) {
      case 'insert_event': {
        const cols = Object.keys(s.row);
        return db
          .prepare(`INSERT INTO events (${cols.join(', ')}) VALUES (${cols.map((_, i) => `?${i + 1}`).join(', ')})`)
          .bind(...cols.map((c) => s.row[c]));
      }
      case 'review_log_create':
        return db
          .prepare(`INSERT INTO review_log (entity_type, entity_id, action, actor, after_json) VALUES ('event', ?1, 'create', ?2, ?3)`)
          .bind(s.entityId, s.actor, s.afterJson);
      case 'review_log_transition':
        return db
          .prepare(`INSERT INTO review_log (entity_type, entity_id, action, from_status, to_status, actor) VALUES ('event', ?1, 'transition', ?2, ?3, ?4)`)
          .bind(s.entityId, s.from, s.to, s.actor);
      case 'review_log_edit':
        return db
          .prepare(`INSERT INTO review_log (entity_type, entity_id, action, actor, before_json, after_json) VALUES ('event', ?1, 'edit', ?2, ?3, ?4)`)
          .bind(s.entityId, s.actor, s.beforeJson, s.afterJson);
      case 'update_content': {
        const fields = CONTENT_FIELDS.filter((f) => f in s.row);
        const assignments = fields.map((f, i) => `${f} = ?${i + 1}`).join(', ');
        return db
          .prepare(`UPDATE events SET ${assignments}, last_seen_at = ?${fields.length + 1}, updated_at = ?${fields.length + 1} WHERE id = ?${fields.length + 2}`)
          .bind(...fields.map((f) => s.row[f]), s.nowIso, s.id);
      }
      case 'touch_last_seen':
        return db.prepare(`UPDATE events SET last_seen_at = ?1 WHERE id = ?2`).bind(s.nowIso, s.id);
      default:
        throw new Error(`applyEventUpsert: unknown statement kind ${s.kind}`);
    }
  });
  return db.batch(stmts);
}

/**
 * @param {object} deps
 * @param {number} deps.now
 * @param {Function} deps.fetchImpl
 * @param {Function} deps.claimSlot - async (sourceId, now) => boolean
 * @param {Function} deps.loadPendingPages - async (limit) => Array<{ id, sourceId, host, url, source: <sources row> }>
 * @param {Function} deps.loadExistingEvent - async ({ sourceHost, sourceEventRef, dedupeKey }) => existing row or null
 * @param {Function} deps.applyUpsert - async (statements) => void, defaults to a no-op-safe binding of applyEventUpsert(db, ...)
 * @param {Function} deps.markPageFetched - async (pageId) => void
 * @param {Function} deps.markPageFailed - async (pageId, reason) => void
 * @param {number} [deps.maxPages] - bounds one invocation's work, since each
 *   page is its own rate-limited fetch (Worker execution time is not infinite).
 */
export async function runIngest({
  now,
  fetchImpl,
  claimSlot,
  loadPendingPages,
  loadExistingEvent,
  applyUpsert,
  markPageFetched,
  markPageFailed,
  maxPages = 20,
}) {
  for (const fn of [fetchImpl, claimSlot, loadPendingPages, loadExistingEvent, applyUpsert, markPageFetched, markPageFailed]) {
    if (typeof fn !== 'function') throw new Error('runIngest requires every dependency as an injected function');
  }

  const pages = await loadPendingPages(maxPages);
  let fetched = 0;
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  const failed = [];

  for (const page of pages) {
    const gate = checkSource(page.source);
    if (!gate.allowed) {
      failed.push({ url: page.url, reason: gate.reason });
      // eslint-disable-next-line no-await-in-loop
      await markPageFailed(page.id, gate.reason);
      continue;
    }
    const parser = PARSERS[page.source.id];
    if (!parser) {
      failed.push({ url: page.url, reason: `no parser registered for source ${page.source.id}` });
      // eslint-disable-next-line no-await-in-loop
      await markPageFailed(page.id, 'no parser registered');
      continue;
    }

    // eslint-disable-next-line no-await-in-loop -- one company's clock at a time
    const claimed = await claimSlot(page.source.id, now);
    if (!claimed) {
      // Not a failure: this page stays 'pending' for a later run to try
      // again once the shared clock allows it.
      continue;
    }

    let response;
    try {
      // eslint-disable-next-line no-await-in-loop
      response = await fetchOnce(page.url, { fetchImpl, allowHost: page.host, pathAllowed: (p) => parser.pathAllowed(p, { host: page.host }), now: () => now });
    } catch (err) {
      const reason = err instanceof FetchRefused ? `fetch refused: ${err.message}` : `fetch failed: ${err?.message ?? err}`;
      failed.push({ url: page.url, reason });
      // eslint-disable-next-line no-await-in-loop
      await markPageFailed(page.id, reason);
      continue;
    }
    fetched += 1;

    const grounding = groundPage(response);
    if (!grounding.grounded) {
      failed.push({ url: page.url, reason: `not grounded: ${grounding.reason}` });
      // eslint-disable-next-line no-await-in-loop
      await markPageFailed(page.id, `not grounded: ${grounding.reason}`);
      continue;
    }

    const parsed = parser.parseEventPage(response.body, { url: page.url });
    if (!parsed.ok) {
      failed.push({ url: page.url, reason: parsed.reason });
      // eslint-disable-next-line no-await-in-loop
      await markPageFailed(page.id, parsed.reason);
      continue;
    }

    const draft = parser.toDraftRow(parsed.event);
    // eslint-disable-next-line no-await-in-loop
    const existing = await loadExistingEvent({ sourceHost: draft.source_host, sourceEventRef: draft.source_event_ref, dedupeKey: draft.dedupe_key });
    const nowIso = new Date(now).toISOString();
    const { outcome, statements } = planEventUpsert({ existing, draft, actor: `system:scout-${page.source.id}`, nowIso });
    // eslint-disable-next-line no-await-in-loop
    await applyUpsert(statements);
    if (outcome === 'inserted') inserted += 1;
    else if (outcome === 'unchanged') unchanged += 1;
    else updated += 1;

    // eslint-disable-next-line no-await-in-loop
    await markPageFetched(page.id);
  }

  return { fetched, inserted, updated, unchanged, failed };
}
