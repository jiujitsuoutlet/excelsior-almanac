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

// Real waiting. Injected in tests so a ten-second crawl delay can be proven
// without a test that takes ten seconds; the guard below the wait is what
// makes an injected sleep unable to lie about it.
export const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export async function runScoutRun({
  component = DEFAULT_COMPONENT,
  region = null,
  now = () => Date.now(),
  fetchImpl,
  loadSources,
  openRun,
  closeRun,
  pageCapPerHost,
  sleep = defaultSleep,
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
  let aborted = null;
  try {
    for (const entry of plan) {
      // EXC-147. `queue.js` works out the earliest moment each page may be
      // requested; until this loop actually WAITS for it, that number is
      // decoration. The ten-second spacing is the condition this source was
      // reviewed under, so it is enforced here, in the one place a request
      // can be made.
      const waitMs = entry.scheduledAt - now();
      // eslint-disable-next-line no-await-in-loop -- waiting is the point
      if (waitMs > 0) await sleep(waitMs, entry);

      // And the wait is CHECKED, not trusted. A sleep that returns early (a
      // broken injection, a clock that jumped) would otherwise fetch early
      // and silently break the crawl law while every test still passed.
      const early = entry.scheduledAt - now();
      if (early > 0) {
        throw new Error(
          `refusing to fetch ${entry.host} ${early}ms before its scheduled time; ` +
          'the crawl delay is the condition this source was reviewed under',
        );
      }

      try {
        // eslint-disable-next-line no-await-in-loop -- one host at a time, on purpose
        await fetchImpl(entry);
        pagesFetched += 1;
      } catch {
        errors += 1;
      }
    }
  } catch (err) {
    // A rule refusal, not a page failure: the run ends here and says so. The
    // crawl_runs row is still closed below, so nothing is left "running".
    aborted = err;
    errors += 1;
  }

  const status = errors > 0 ? 'failed' : 'succeeded';
  const finishedAt = now();
  await closeRun({ runId, status, finishedAt, pagesFetched, errors, hostsSkipped: skipped.length });

  if (aborted) throw aborted;
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
