// crawl_runs bookkeeping: open a row when a crawl phase starts, close it with
// its counts when it ends. The superseded single-pass runner that used to
// live here (runScoutRun, with its own `fetchImpl(entry)` call and its queue.js
// planner) was deleted 2026-09-21: nothing in the Worker called it, and it was
// a second path to the network outside the one fetch gate (fetchgate.js,
// founder ruling). A fetch path that exists but is unused is still a fetch
// path; the proof that no other one exists is only honest once it is gone.

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
  return async ({ runId, status, finishedAt, pagesFetched, errors, hostsSkipped, draftsCreated = 0 }) => {
    await db
      .prepare(
        'UPDATE crawl_runs SET status = ?1, finished_at = ?2, pages_fetched = ?3, errors = ?4, hosts_skipped = ?5, drafts_created = ?7 WHERE id = ?6',
      )
      .bind(status, new Date(finishedAt).toISOString(), pagesFetched, errors, hostsSkipped, runId, draftsCreated)
      .run();
  };
}
