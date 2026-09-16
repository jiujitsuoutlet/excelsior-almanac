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
