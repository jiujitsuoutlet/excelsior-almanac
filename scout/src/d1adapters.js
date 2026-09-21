// The real D1 adapters for discover.js/ingest.js/linkcheck.js's injected
// dependencies -- production I/O, never used directly by their own unit
// tests (which inject plain fakes instead), the same split run.js's own
// d1SourceLoader/d1AliasLoader already established.

import { claimRateLimitSlot, minIntervalSeconds } from './limiter.js';
import { boundingBox } from './geo.js';
import { applyEventUpsert } from './ingest.js';

function realSleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// The real cross-invocation clock, now with real waiting (Opus review,
// 2026-09-19, B5/B6): discover.js/ingest.js/linkcheck.js each loop over
// several items that can belong to the SAME company (every alias of one
// source in discover.js's own loop; every pending page in ingest.js's;
// three phases run back to back from index.js's runCrawlCycle). A single
// claim-or-refuse attempt per item meant only the very first claimer in a
// whole invocation ever got the company's slot -- everyone else, every
// night, forever. This waits in real time (bounded by waitBudgetMs) for
// the slot to free, honoring the source's own real Crawl-delay
// (limiter.js's minIntervalSeconds) rather than the 10-second floor
// alone -- so item 2, item 3, and the next phase all get their turn
// within the same invocation instead of being refused permanently.
//
// Deliberately real Date.now()/real setTimeout here, not the caller's
// injected `now`: that value exists so discover.js/ingest.js/linkcheck.js
// stay pure and unit-testable with no clock and no network (same as
// d1RunOpener/d1RunCloser already using real Date.now()-derived
// timestamps directly). Their own unit tests inject a plain fake
// claimSlot and never exercise this real-waiting adapter.
export function d1ClaimSlot(db, { sleep = realSleep, waitBudgetMs = 90_000 } = {}) {
  return async (source) => {
    const intervalMs = minIntervalSeconds(source?.robots_crawl_delay_seconds) * 1000;
    const deadline = Date.now() + waitBudgetMs;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- one company's clock at a time, on purpose
      const claimed = await claimRateLimitSlot(db, source.id, Date.now(), minIntervalSeconds(source?.robots_crawl_delay_seconds));
      if (claimed) return true;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      // eslint-disable-next-line no-await-in-loop
      await sleep(Math.min(intervalMs, remaining));
    }
  };
}

// Every active alias, joined with its company's full terms-review row
// (checkSource needs every field; an alias alone has none of them).
export function d1ActiveAliasesWithSourceLoader(db) {
  return async () => {
    const { results } = await db
      .prepare(
        `SELECT sa.id AS alias_id, sa.host AS alias_host, sa.listing_path AS listing_path,
                sa.robots_sha256 AS alias_robots_sha256,
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
      robotsSha256: r.alias_robots_sha256,
      source: { ...r, id: r.id }, // r already carries every `sources` column via s.*
    }));
  };
}

export function d1EnqueueDiscovered(db) {
  return async ({ sourceId, host, urls }) => {
    if (urls.length === 0) return;
    // One statement PER URL, run and awaited individually rather than as
    // one db.batch() -- a batch is atomic, so one URL this table's own
    // CHECK constraints reject (Opus review, 2026-09-19, B7: a stray
    // http:// link discovered_pages.url's `LIKE 'https://%'` CHECK
    // rejects) used to take down every other URL on the same listing
    // page with it, every single night. classifyUrl now refuses http:
    // before a URL ever reaches here (belt), but this loop no longer
    // trusts that alone (suspenders): one row's rejection is swallowed
    // and reported, never lets a sibling row's insert fail with it.
    const failed = [];
    for (const url of urls) {
      try {
        // eslint-disable-next-line no-await-in-loop -- each row's own outcome must not be entangled with its siblings'
        await db
          .prepare(
            `INSERT INTO discovered_pages (id, source_id, host, url)
             SELECT ?1, ?2, ?3, ?4
             WHERE NOT EXISTS (SELECT 1 FROM discovered_pages WHERE url = ?4)`,
          )
          .bind(crypto.randomUUID(), sourceId, host, url)
          .run();
      } catch (err) {
        failed.push({ url, reason: err?.message ?? String(err) });
      }
    }
    return { failed };
  };
}

// Puts a 'fetched' discovered_pages row back to 'pending' once it goes
// stale, so ingest.js's change-detection can ever see a real edit on an
// already-ingested page again (Opus review, 2026-09-19, B8). Schema-legal:
// discovered_pages_immutable_identity only guards identity columns, and
// flipping status+fetched_at together satisfies the table's own
// CHECK ((status='pending') = (fetched_at IS NULL)).
export function d1RequeueStalePages(db) {
  return async (staleBeforeIso, limit) => {
    const result = await db
      .prepare(
        `UPDATE discovered_pages SET status = 'pending', fetched_at = NULL
         WHERE id IN (
           SELECT id FROM discovered_pages
           WHERE status = 'fetched' AND fetched_at <= ?1
           ORDER BY fetched_at ASC
           LIMIT ?2
         )`,
      )
      .bind(staleBeforeIso, limit)
      .run();
    return result?.meta?.changes ?? 0;
  };
}

// A 403 is an answer that stops that host (founder condition; Opus
// review, 2026-09-19, B12) -- not a page to retry tomorrow. Pausing the
// SOURCE (not just the one alias) means every alias of the same company
// stops too, matching the shared-clock, one-company-many-hostnames
// design (section 9): a 403 is a fact about the company, not one
// subdomain. Requires a human to look again before this source is ever
// crawled again (checkSource/the gate refuses an inactive source).
export function d1DeactivateSource(db) {
  return (sourceId) => db.prepare(`UPDATE sources SET active = 0 WHERE id = ?1`).bind(sourceId).run();
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

// 'excluded' is the status for a page this crawl will never fetch -- not a
// failure, and not left pending forever pretending it is still queued.
export function d1MarkPageExcluded(db) {
  return (pageId, reason) =>
    db
      .prepare(`UPDATE discovered_pages SET status = 'excluded', fetched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), fail_reason = ?2 WHERE id = ?1`)
      .bind(pageId, reason)
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
//
// Re-checks the event's own SOURCE_URL (the event detail page), never
// registration_url directly (Opus review, 2026-09-19, B1/B9): a
// registration_url is typically an /order/ or /checkout path -- exactly
// what the terms review says to never fetch, and this loader used to
// hand that URL straight to a fetch. source_url is always an
// EVENT_DETAIL_PATH page, the one page type this crawl is reviewed to
// touch; the parser re-parsing it and finding the registration link
// still present is the actual liveness signal, not fetching the
// registration flow itself. This also fixes the second half of B9: an
// off-platform or bare-domain registration_url used to make fetchOnce's
// own host-allowlist refuse the fetch, and that refusal was read as "the
// link is dead" and demoted the row for a reason that had nothing to do
// with the link. Re-checking source_url is always same-host by
// construction, so that false demotion path no longer exists.
export function d1StaleApprovedLinksLoader(db) {
  return async (staleBeforeIso, limit) => {
    const { results } = await db
      .prepare(
        `SELECT e.id AS event_id, e.source_url AS source_url, e.source_host AS event_source_host,
                e.registration_url AS event_registration_url, e.link_check_method AS link_check_method,
                s.*
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
      sourceUrl: r.source_url,
      registrationUrl: r.event_registration_url,
      linkCheckMethod: r.link_check_method,
      host: r.event_source_host,
      sourceId: r.id,
      source: { ...r, id: r.id },
    }));
  };
}

// `method` is recorded alongside the timestamp, never inferred later: a row
// that was only structurally checked must not become indistinguishable from
// one that answered a real 200 (founder ruling, 2026-09-20 -- the
// fail-closed law).
export function d1MarkLinkLive(db) {
  return (eventId, nowIso, method = 'live') =>
    db.prepare(`UPDATE events SET link_checked_at = ?1, link_check_method = ?2 WHERE id = ?3`).bind(nowIso, method, eventId).run();
}

// Rule 4 (section 9): a daily robots.txt hash check, per alias. Same hash
// as recorded, same day: the read is simply refreshed. A different hash:
// the alias is paused (active=0) rather than silently re-crawled under
// rules nobody re-reviewed -- robots_sha256/robots_read_on are left
// exactly as they were (the record of what was reviewed), so a human
// looking at this alias later sees the frozen, reviewed hash next to a
// paused, inactive row, not a quietly overwritten one.
export function d1MarkAliasRobotsFresh(db) {
  return (aliasId, todayIso) =>
    db.prepare(`UPDATE source_aliases SET robots_read_on = ?1, updated_at = ?2 WHERE id = ?3`).bind(todayIso, todayIso, aliasId).run();
}

export function d1PauseAliasForRobotsDrift(db) {
  return (aliasId) => db.prepare(`UPDATE source_aliases SET active = 0 WHERE id = ?1`).bind(aliasId).run();
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

// The gazetteer read behind geo.js's deriveState: a small bounding box
// around one point, never the whole table. geo.js then does exact haversine
// over the handful of rows this returns, so the SQL never has to be trusted
// to compute distance correctly.
export function d1NearbyPlaces(db) {
  return async (lat, lon, km) => {
    const box = boundingBox(lat, lon, km);
    const { results } = await db
      .prepare(`SELECT geoname_id, city, state, lat, lon FROM places
                WHERE lat BETWEEN ?1 AND ?2 AND lon BETWEEN ?3 AND ?4`)
      .bind(box.minLat, box.maxLat, box.minLon, box.maxLon)
      .all();
    return results;
  };
}
