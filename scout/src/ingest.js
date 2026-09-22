// Phase 2 of the real crawl (founder ruling, 2026-09-19): work the
// discovered_pages queue down, oldest first, fetching each detail page
// (rate-limited per company, exactly like discovery), parsing it, and
// writing a real, trigger-respecting row into `events`.
//
// planEventUpsert() is the pure decision: given what (if anything)
// already exists for this event and what was just parsed, exactly which
// statements need to run. applyEventUpsert() is the thin, separately-
// testable adapter that turns those statements into real D1 calls. This
// split keeps the DECISION
// unit-testable with no database; only the ADAPTER touches D1's actual
// API shape.

import { groundPage } from './grounding.js';
import { FetchRefused } from './fetcher.js';
import { gatedFetch } from './fetchgate.js';
import { parserForSource } from './parsers/index.js';

// A detail page fetched once and never revisited can never have its
// change-detection machinery (planEventUpsert's demote-then-update path)
// fire at all -- a moved date or a dead registration link on an
// already-ingested page is invisible forever (Opus review, 2026-09-19,
// B8). Re-queuing a 'fetched' page back to 'pending' after it goes stale
// is schema-legal (discovered_pages_immutable_identity only guards id/
// source_id/host/url/discovered_at; status+fetched_at are exactly the
// two columns this flips together, satisfying the table's own
// CHECK ((status='pending') = (fetched_at IS NULL))).
export const REQUEUE_AFTER_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

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
 * @param {Function} deps.claimSlot - async (source) => boolean, the full
 *   `sources` row (its own real Crawl-delay lives on it)
 * @param {Function} deps.loadPendingPages - async (limit) => Array<{ id, sourceId, host, url, source: <sources row> }>
 * @param {Function} deps.loadExistingEvent - async ({ sourceHost, sourceEventRef, dedupeKey }) => existing row or null
 * @param {Function} deps.applyUpsert - async (statements) => void, defaults to a no-op-safe binding of applyEventUpsert(db, ...)
 * @param {Function} deps.markPageFetched - async (pageId) => void
 * @param {Function} deps.markPageFailed - async (pageId, reason) => void
 * @param {number} [deps.maxPages] - bounds one invocation's work, since each
 *   page is its own rate-limited fetch (Worker execution time is not infinite).
 * @param {Function} [deps.requeueStalePages] - async (staleBeforeIso, limit) =>
 *   number of rows requeued; puts old 'fetched' pages back to 'pending' so
 *   a real change (a moved date, a dead registration link) on an
 *   already-ingested page is ever seen again. Defaults to a no-op only for
 *   callers that don't care (most existing tests, which never fetched a
 *   page before); the real crawl always wires this to a real requeue.
 * @param {number} [deps.requeueAfterMs]
 * @param {number} [deps.requeueLimit]
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
  markPageExcluded = async () => {},
  maxPages = 20,
  deactivateSource = async () => {},
  aliasesBySource = {},
  requeueStalePages = async () => 0,
  requeueAfterMs = REQUEUE_AFTER_MS,
  requeueLimit = 20,
}) {
  for (const fn of [fetchImpl, claimSlot, loadPendingPages, loadExistingEvent, applyUpsert, markPageFetched, markPageFailed]) {
    if (typeof fn !== 'function') throw new Error('runIngest requires every dependency as an injected function');
  }

  const requeued = await requeueStalePages(new Date(now - requeueAfterMs).toISOString(), requeueLimit);
  const pages = await loadPendingPages(maxPages);
  let fetched = 0;
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  const failed = [];
  let excluded = 0;
  // Same per-run, per-company backoff as discover.js (Opus review,
  // 2026-09-19, B12): a 403/429/503 on page 3 of 20 means pages 4-20 of
  // the SAME company are not hammered a moment later.
  const backedOff = new Set();

  for (const page of pages) {
    if (backedOff.has(page.source.id)) {
      // Left 'pending', not failed: this is our own restraint, not a
      // defect in the page, so a later run should still try it.
      continue;
    }

    // Whether this page may be fetched at all is decided in ONE place,
    // fetchgate.js (founder ruling, 2026-09-21). Ingest used to carry its
    // own copies of the terms gate and the listing_only rule; link-check
    // lacked the second copy, and that gap paused the production source.
    let result;
    try {
      // eslint-disable-next-line no-await-in-loop -- one company's clock at a time
      result = await gatedFetch(page.url, { source: page.source, aliases: aliasesBySource[page.source.id] ?? [], fetchImpl, claimSlot, now });
    } catch (err) {
      const reason = err instanceof FetchRefused ? `fetch refused: ${err.message}` : `fetch failed: ${err?.message ?? err}`;
      failed.push({ url: page.url, reason });
      // eslint-disable-next-line no-await-in-loop
      await markPageFailed(page.id, reason);
      continue;
    }
    if (result.rateLimited) {
      // Not a failure: this page stays 'pending' for a later run to try
      // again once the shared clock allows it.
      continue;
    }
    if (result.refused) {
      // listing_only is not a defect in the page: it is a page this crawl
      // will never fetch, which is exactly what 'excluded' means. Any other
      // refusal (an unreviewed host, a gated source, an excluded path) is a
      // failure worth a human's attention.
      if (result.refused.code === 'listing_only') {
        excluded += 1;
        // eslint-disable-next-line no-await-in-loop
        await markPageExcluded(page.id, result.refused.reason);
      } else {
        failed.push({ url: page.url, reason: result.refused.reason });
        // eslint-disable-next-line no-await-in-loop
        await markPageFailed(page.id, result.refused.reason);
      }
      continue;
    }
    const { response } = result;
    const parser = parserForSource(page.source);
    fetched += 1;

    if (response.status === 403) {
      backedOff.add(page.source.id);
      failed.push({ url: page.url, reason: 'http 403; the host said no -- this source is being paused for human review, not retried' });
      // eslint-disable-next-line no-await-in-loop
      await markPageFailed(page.id, 'http 403 from host');
      // eslint-disable-next-line no-await-in-loop
      await deactivateSource(page.source.id, `ingest got http 403 from ${page.host}`);
      continue;
    }
    if (response.status === 429 || response.status === 503) {
      backedOff.add(page.source.id);
      // Left 'pending', not failed: the page itself is fine, the host just
      // asked us to slow down. A later run tries again.
      continue;
    }

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

  return { fetched, inserted, updated, unchanged, failed, requeued, excluded };
}
