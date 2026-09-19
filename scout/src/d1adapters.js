// The real D1 adapters for discover.js/ingest.js/linkcheck.js's injected
// dependencies -- production I/O, never used directly by their own unit
// tests (which inject plain fakes instead), the same split run.js's own
// d1SourceLoader/d1AliasLoader already established.

import { claimRateLimitSlot } from './limiter.js';
import { applyEventUpsert } from './ingest.js';

export function d1ClaimSlot(db) {
  return (sourceId, now) => claimRateLimitSlot(db, sourceId, now);
}

// Every active alias, joined with its company's full terms-review row
// (checkSource needs every field; an alias alone has none of them).
export function d1ActiveAliasesWithSourceLoader(db) {
  return async () => {
    const { results } = await db
      .prepare(
        `SELECT sa.id AS alias_id, sa.host AS alias_host, sa.listing_path AS listing_path,
                s.*
         FROM source_aliases sa
         JOIN sources s ON s.id = sa.source_id
         WHERE sa.active = 1`,
      )
      .all();
    return results.map((r) => ({
      aliasId: r.alias_id,
      host: r.alias_host,
      listingPath: r.listing_path,
      source: { ...r, id: r.id }, // r already carries every `sources` column via s.*
    }));
  };
}

export function d1EnqueueDiscovered(db) {
  return async ({ sourceId, host, urls }) => {
    if (urls.length === 0) return;
    // One INSERT per URL rather than a single multi-row statement: `url`
    // is UNIQUE, and a duplicate (a page discovered again on a later
    // listing fetch) must be silently skipped, not abort the whole
    // batch. D1 does not support INSERT OR IGNORE alongside the
    // append-only triggers cleanly across a variable-length VALUES list,
    // so each URL gets its own statement and its own conflict handling.
    const stmts = urls.map((url) =>
      db
        .prepare(
          `INSERT INTO discovered_pages (id, source_id, host, url)
           SELECT ?1, ?2, ?3, ?4
           WHERE NOT EXISTS (SELECT 1 FROM discovered_pages WHERE url = ?4)`,
        )
        .bind(crypto.randomUUID(), sourceId, host, url),
    );
    await db.batch(stmts);
  };
}

export function d1PendingPagesLoader(db) {
  return async (limit) => {
    const { results } = await db
      .prepare(
        `SELECT dp.id AS page_id, dp.host AS page_host, dp.url AS page_url, dp.source_id AS source_id,
                s.*
         FROM discovered_pages dp
         JOIN sources s ON s.id = dp.source_id
         WHERE dp.status = 'pending'
         ORDER BY dp.discovered_at ASC
         LIMIT ?1`,
      )
      .bind(limit)
      .all();
    return results.map((r) => ({
      id: r.page_id,
      host: r.page_host,
      url: r.page_url,
      source: { ...r, id: r.id },
    }));
  };
}

export function d1ExistingEventLoader(db) {
  return async ({ sourceHost, sourceEventRef, dedupeKey }) => {
    const { results } = await db
      .prepare(
        `SELECT * FROM events
         WHERE (source_event_ref IS NOT NULL AND source_host = ?1 AND source_event_ref = ?2)
            OR dedupe_key = ?3
         LIMIT 1`,
      )
      .bind(sourceHost, sourceEventRef, dedupeKey)
      .all();
    return results[0] ?? null;
  };
}

export function d1ApplyUpsert(db) {
  return (statements) => applyEventUpsert(db, statements);
}

export function d1MarkPageFetched(db) {
  return (pageId) =>
    db
      .prepare(`UPDATE discovered_pages SET status = 'fetched', fetched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1`)
      .bind(pageId)
      .run();
}

export function d1MarkPageFailed(db) {
  return (pageId, reason) =>
    db
      .prepare(`UPDATE discovered_pages SET status = 'failed', fetched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), fail_reason = ?2 WHERE id = ?1`)
      .bind(pageId, reason)
      .run();
}

// Only links whose host is a currently active, reviewed alias (or the
// source's own bare host) -- a link-check must never fetch a URL this
// crawl has no terms-review coverage for, even to check it is alive.
export function d1StaleApprovedLinksLoader(db) {
  return async (staleBeforeIso, limit) => {
    const { results } = await db
      .prepare(
        `SELECT e.id AS event_id, e.registration_url AS registration_url, e.source_host AS event_source_host,
                s.id AS matched_source_id
         FROM events e
         JOIN (
           SELECT host AS matched_host, source_id FROM source_aliases WHERE active = 1
           UNION
           SELECT host AS matched_host, id AS source_id FROM sources
         ) m ON m.matched_host = e.source_host
         JOIN sources s ON s.id = m.source_id
         WHERE e.status = 'approved'
           AND e.registration_url IS NOT NULL
           AND (e.link_checked_at IS NULL OR e.link_checked_at <= ?1)
         ORDER BY e.link_checked_at ASC NULLS FIRST
         LIMIT ?2`,
      )
      .bind(staleBeforeIso, limit)
      .all();
    return results.map((r) => ({
      id: r.event_id,
      registrationUrl: r.registration_url,
      host: r.event_source_host,
      sourceId: r.matched_source_id,
    }));
  };
}

export function d1MarkLinkLive(db) {
  return (eventId, nowIso) => db.prepare(`UPDATE events SET link_checked_at = ?1 WHERE id = ?2`).bind(nowIso, eventId).run();
}

// Demotes approved -> needs_review through the real review_log
// transition (never a raw UPDATE of status), then records why, then
// stamps link_checked_at so this same link is not immediately re-tried
// on the very next run.
export function d1DemoteDeadLink(db) {
  return (eventId, nowIso, reason, actor) =>
    db.batch([
      db
        .prepare(`INSERT INTO review_log (entity_type, entity_id, action, from_status, to_status, actor, reason_code) VALUES ('event', ?1, 'transition', 'approved', 'needs_review', ?2, 'link_check_failed')`)
        .bind(eventId, actor),
      db.prepare(`UPDATE events SET link_checked_at = ?1 WHERE id = ?2`).bind(nowIso, eventId),
    ]);
}
