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

// A source with no aliases still crawls under its own host, exactly as
// before this existed... every prior caller (and every prior test) keeps
// working unchanged.
function targetsOf(source, aliasesBySourceId) {
  const rows = (aliasesBySourceId?.[source.id] ?? []).filter((a) => a.active === 1);
  return rows.length > 0 ? rows.map((a) => a.host) : [source.host];
}

// Builds { plan, skipped } from a list of `sources` rows and, optionally,
// their `source_aliases` rows (ARCHITECTURE.md section 9, "one company,
// many hostnames": one source row per company, human-approved alias
// hostnames the crawl actually targets). Without `aliases`, a source
// crawls under its own `host`, same as always.
//   plan:    [{ host, rateLimitHost, pageType, scheduledAt }, ...], spaced
//            per limiter.js and capped at `pageCapPerHost` pages per
//            RATE-LIMIT HOST (the company) for this run. `host` is the
//            real fetch target (an alias, or the source's own host with
//            no aliases); `rateLimitHost` is always the source's own
//            host, the "one clock per company" rule -- ten organizer
//            subdomains still share one 10-second clock, not ten.
//   skipped: [{ host, reason }, ...], one entry per source the gate
//            refused (never per alias: a company-level refusal blocks
//            every one of its aliases at once, by construction, since
//            targetsOf() is only ever called after the gate allows).
//
// `now` is the run's own clock reading (epoch milliseconds). `limiterState`
// carries forward the last-fetch time per rate-limit host from a previous
// run, if the caller has one; a fresh run may omit it.
export function buildPlan(sources, now, { pageCapPerHost = DEFAULT_PAGE_CAP_PER_HOST, limiterState = {}, aliases = [] } = {}) {
  const plan = [];
  const skipped = [];
  let state = limiterState;

  const aliasesBySourceId = {};
  for (const alias of aliases ?? []) {
    (aliasesBySourceId[alias.source_id] ??= []).push(alias);
  }

  for (const source of sources ?? []) {
    const gate = checkSource(source);
    if (!gate.allowed) {
      skipped.push({ host: source?.host ?? null, reason: gate.reason });
      continue;
    }

    const rateLimitHost = source.host;
    const targets = targetsOf(source, aliasesBySourceId);
    const pageTypes = pageTypesOf(source).slice(0, pageCapPerHost);
    for (const host of targets) {
      for (const pageType of pageTypes) {
        const scheduledAt = nextAllowedAt(rateLimitHost, now, state, source.robots_crawl_delay_seconds);
        plan.push({ host, rateLimitHost, pageType, scheduledAt });
        state = recordFetch(rateLimitHost, scheduledAt, state);
      }
    }
  }

  return { plan, skipped };
}
