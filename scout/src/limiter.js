// A pure, per-host rate limiter. No timers, no sleeping: the caller supplies
// "now" and gets back the next time a request to that host is allowed. The
// caller is responsible for actually waiting.
//
// Crawl law (ARCHITECTURE.md section 9 / MAD v2.54 decision 6): one request
// per host per 10 seconds, or the host's own Crawl-delay when it asks for
// longer. This module never makes that number shorter.

export const MINIMUM_INTERVAL_SECONDS = 10;

// The interval that applies to a host, given the Crawl-delay its robots.txt
// declared (or null/undefined when it declared none, or an invalid value).
export function minIntervalSeconds(crawlDelaySeconds) {
  const delay = Number(crawlDelaySeconds);
  if (!Number.isFinite(delay) || delay <= MINIMUM_INTERVAL_SECONDS) return MINIMUM_INTERVAL_SECONDS;
  return delay;
}

// `state` is a plain object mapping host -> the epoch millisecond timestamp
// of the last request the caller recorded for it. A host absent from state
// has never been fetched, so it is allowed at `now`.
export function nextAllowedAt(host, now, state = {}, crawlDelaySeconds = null) {
  const last = state[host];
  if (last === undefined || last === null) return now;
  const intervalMs = minIntervalSeconds(crawlDelaySeconds) * 1000;
  return Math.max(now, last + intervalMs);
}

// Returns a NEW state object with `host` recorded as fetched at `at`. Pure:
// the input state is never mutated.
export function recordFetch(host, at, state = {}) {
  return { ...state, [host]: at };
}

// The REAL rate limit, enforced across separate Worker invocations --
// nextAllowedAt/recordFetch above are pure, in-memory, per-run state, and
// cannot see what a DIFFERENT scheduled invocation of this same Worker
// did a moment ago (each gets its own fresh memory; the founder's own
// example is the nightly Tier 1 run and the daily link-recheck run
// touching the same company's hosts). A real cross-run clock has to live
// somewhere both invocations can see: `sources.last_claimed_at`
// (migration 20260919010000), claimed with one atomic UPDATE ... WHERE.
//
// D1 is a single-writer SQLite database, so this single UPDATE statement
// either claims the slot or it doesn't -- there is no read-then-write
// window for a second, truly concurrent invocation to race into. Returns
// true only when THIS call's UPDATE actually changed the row (D1's own
// `meta.changes`), which happens only when no one already claimed this
// company's clock within `minIntervalSeconds` of `now`. A caller that
// gets false must not fetch: someone else's turn, or this same company
// was already claimed by an earlier step in this same run.
export async function claimRateLimitSlot(db, sourceId, now, minIntervalSeconds = MINIMUM_INTERVAL_SECONDS) {
  const nowIso = new Date(now).toISOString();
  const cutoffIso = new Date(now - minIntervalSeconds * 1000).toISOString();
  const result = await db
    .prepare(
      `UPDATE sources SET last_claimed_at = ?1
       WHERE id = ?2 AND (last_claimed_at IS NULL OR last_claimed_at <= ?3)`,
    )
    .bind(nowIso, sourceId, cutoffIso)
    .run();
  return result?.meta?.changes === 1;
}
