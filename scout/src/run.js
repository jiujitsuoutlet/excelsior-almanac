// The scout runner. Opens a `crawl_runs` row, builds a plan from the gate and
// queue, attempts each planned page through an INJECTED fetch function, and
// closes the run with counts.
//
// The fetch function is a parameter, never a default, and never the global
// `fetch`. In this pull request the only fetcher ever wired up (see
// index.js) throws on every call, so no page is ever actually requested.
// Gate refusals never reach the fetch step at all: they are counted as
// `skipped` before the loop below starts, from `queue.js`'s own plan.
//
// runScoutRun takes every I/O boundary as an injected function (loadSources,
// openRun, closeRun, fetchImpl), so it can be unit-tested with no real
// database and no real network. The d1*() helpers below are the production
// adapters index.js wires up against the real D1 binding.

import { buildPlan } from './queue.js';

export const DEFAULT_COMPONENT = 'tier1_scout';

export async function runScoutRun({
  component = DEFAULT_COMPONENT,
  region = null,
  now = () => Date.now(),
  fetchImpl,
  loadSources,
  openRun,
  closeRun,
  pageCapPerHost,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('runScoutRun requires an injected fetchImpl; it never defaults to a real fetch');
  if (typeof loadSources !== 'function') throw new Error('runScoutRun requires an injected loadSources function');
  if (typeof openRun !== 'function') throw new Error('runScoutRun requires an injected openRun function');
  if (typeof closeRun !== 'function') throw new Error('runScoutRun requires an injected closeRun function');

  const startedAt = now();
  const runId = await openRun({ component, region, startedAt });

  const sources = await loadSources();
  const { plan, skipped } = buildPlan(sources, startedAt, { pageCapPerHost });

  let pagesFetched = 0;
  let errors = 0;
  for (const entry of plan) {
    try {
      // eslint-disable-next-line no-await-in-loop -- one host at a time, on purpose (the limiter already spaced `scheduledAt`)
      await fetchImpl(entry);
      pagesFetched += 1;
    } catch {
      errors += 1;
    }
  }

  const status = errors > 0 ? 'failed' : 'succeeded';
  const finishedAt = now();
  await closeRun({ runId, status, finishedAt, pagesFetched, errors, hostsSkipped: skipped.length });

  return { runId, status, pagesFetched, errors, skipped, plan };
}

// The fetcher wired up in this pull request. Fetching is not enabled in the
// skeleton: calling this is always a loud failure, never a silent no-op, so
// a future PR that wires up a real fetcher cannot do so by accident.
export function disabledFetch() {
  throw new Error('fetching is not enabled in the skeleton');
}

// ---- D1 adapters (production I/O; never used directly by the tests) ----

export function d1SourceLoader(db) {
  return async () => {
    const { results } = await db.prepare('SELECT * FROM sources').all();
    return results;
  };
}

export function d1RunOpener(db) {
  return async ({ component, region, startedAt }) => {
    const id = crypto.randomUUID();
    await db
      .prepare("INSERT INTO crawl_runs (id, component, region, status, started_at) VALUES (?1, ?2, ?3, 'running', ?4)")
      .bind(id, component, region, new Date(startedAt).toISOString())
      .run();
    return id;
  };
}

export function d1RunCloser(db) {
  return async ({ runId, status, finishedAt, pagesFetched, errors, hostsSkipped }) => {
    await db
      .prepare(
        'UPDATE crawl_runs SET status = ?1, finished_at = ?2, pages_fetched = ?3, errors = ?4, hosts_skipped = ?5 WHERE id = ?6',
      )
      .bind(status, new Date(finishedAt).toISOString(), pagesFetched, errors, hostsSkipped, runId)
      .run();
  };
}
