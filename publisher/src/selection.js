// Which events are due to publish this cycle, and the SQL that answers it.
// Kept separate from `index.js` so the query text itself is testable without
// a live D1 binding (checked here as a string; exercised for real only in
// `scripts/verify-publisher.sh` against a real database, the same split
// scout uses between its pure-function tests and its shell verification).

// A row publishes when:
//   - it is freshly approved (status='approved', never published before), or
//   - an already-published approved row was edited and re-approved
//     (updated_at moved past the last publish), or
//   - a previously published row went stale (the source no longer confirms
//     it) and that retraction has not reached the app yet.
// A row that is 'rejected', 'needs_review', 'draft', or 'expired' without
// ever having been approved never appears here... it never crossed the
// publish boundary, so there is nothing to send.
export const SELECT_DUE_SQL = `
  SELECT * FROM events
  WHERE (status = 'approved' AND (published_at IS NULL OR updated_at > published_at))
     OR (status = 'stale' AND published_at IS NOT NULL AND updated_at > published_at)
  ORDER BY updated_at ASC
  LIMIT ?
`;

// Marks a batch as sent. Only rows the app actually accepted move
// published_at forward... a partial failure (the app 4xxs or the connection
// drops mid-batch) must not silently mark rows as published that never
// arrived, so this is called only after a confirmed 2xx from the app, over
// the exact id list that batch carried, never "everything due right now."
export const MARK_PUBLISHED_SQL = `
  UPDATE events SET published_at = ? WHERE id IN (SELECT value FROM json_each(?))
`;
