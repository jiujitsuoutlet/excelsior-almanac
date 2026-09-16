// Builds a crawl plan from `sources` rows. Pure: no network, no database, no
// clock of its own (the caller passes `now`). A plan entry never names a host
// the gate refused; every refusal is reported back in `skipped` instead, with
// the gate's own reason, so a refusal is provable without a fetch ever being
// attempted.

import { checkSource } from './gate.js';
import { nextAllowedAt, recordFetch } from './limiter.js';

export const DEFAULT_PAGE_CAP_PER_HOST = 20;

// `source.page_types` is stored as a JSON array (field 1 of the terms
// review). An unreadable or missing value means there is nothing to queue
// for that host, not a crash.
function pageTypesOf(source) {
  if (!source.page_types) return [];
  if (Array.isArray(source.page_types)) return source.page_types;
  try {
    const parsed = JSON.parse(source.page_types);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Builds { plan, skipped } from a list of `sources` rows.
//   plan:    [{ host, pageType, scheduledAt }, ...], spaced per limiter.js
//            and capped at `pageCapPerHost` pages per host for this run.
//   skipped: [{ host, reason }, ...], one entry per source the gate refused.
//
// `now` is the run's own clock reading (epoch milliseconds). `limiterState`
// carries forward the last-fetch time per host from a previous run, if the
// caller has one; a fresh run may omit it.
export function buildPlan(sources, now, { pageCapPerHost = DEFAULT_PAGE_CAP_PER_HOST, limiterState = {} } = {}) {
  const plan = [];
  const skipped = [];
  let state = limiterState;

  for (const source of sources ?? []) {
    const gate = checkSource(source);
    if (!gate.allowed) {
      skipped.push({ host: source?.host ?? null, reason: gate.reason });
      continue;
    }

    const pageTypes = pageTypesOf(source).slice(0, pageCapPerHost);
    for (const pageType of pageTypes) {
      const scheduledAt = nextAllowedAt(source.host, now, state, source.robots_crawl_delay_seconds);
      plan.push({ host: source.host, pageType, scheduledAt });
      state = recordFetch(source.host, scheduledAt, state);
    }
  }

  return { plan, skipped };
}
