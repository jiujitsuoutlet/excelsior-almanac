#!/usr/bin/env bash
# ALMANAC Tier 1 parser battery, for scout/src/parsers/smoothcomp.js.
# Runs against a THROWAWAY LOCAL D1 (never Cloudflare, never a remote
# database), reusing the console's own test environment (console/wrangler.toml
# --env test) the way scripts/verify-scout.sh does, since the parser's output
# is shaped for the same `events` table those migrations create.
#
# The hard rules this battery exists to prove:
#
#   Phase A (pure logic, no D1, no Worker, no network): every fixture in
#   scout/test/fixtures/smoothcomp/ is hand-written synthetic HTML (invented
#   names, dates, venues and ids; never a saved real page) run through
#   parseEventPage() / parseListingPage() directly, in a plain Node process,
#   with the global fetch patched to throw and counted. A candidate the
#   parser accepts is shaped by toDraftRow() into an INSERT statement; a
#   candidate it rejects contributes no SQL at all.
#
#   Phase B (the real schema, via `wrangler d1 execute` against a fresh local
#   database): those INSERT statements are applied through the actual
#   migrations in migrations/, so the database's own CHECK constraints and
#   triggers are what accept or refuse each row, not this script's opinion.
#   A second attempt at the same candidate (a fresh id, the same dedupe_key)
#   proves the unique constraint refuses the repeat.
#
#   bash scripts/verify-parser.sh

set -uo pipefail
cd "$(dirname "$0")/.."
export CI=true
ROOT=$(pwd)

CFG=console/wrangler.toml
DB_NAME=almanac-console-test
WR=(npx wrangler)
TMP=$(mktemp -d)
PASS=0; FAIL=0

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

ok()  { PASS=$((PASS+1)); echo "PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL  $1"; }

d1() { # command
  local out
  if ! out=$("${WR[@]}" d1 execute "$DB_NAME" --local --env test --config "$CFG" --persist-to "$TMP/db" --command "$1" 2>&1); then
    bad "setup step failed: $1"; echo "$out" | tail -5
  fi
}
d1file() { # file -> exit status 0/1, output on stdout
  "${WR[@]}" d1 execute "$DB_NAME" --local --env test --config "$CFG" --persist-to "$TMP/db" --file "$1" 2>&1
}
d1json() { # command -> json on stdout
  "${WR[@]}" d1 execute "$DB_NAME" --local --env test --config "$CFG" --persist-to "$TMP/db" --json --command "$1" 2>/dev/null | sed -n '/^\[/,$p'
}

echo "== preparing a throwaway local D1 (migrations from migrations/, applied fresh)"
"${WR[@]}" d1 migrations apply "$DB_NAME" --local --env test --config "$CFG" --persist-to "$TMP/db" 2>&1 | grep -E "✅|ERROR" | head -5

echo "== phase A: parsing every fixture, with no D1 and no network in reach"
cat > "$TMP/parse-fixtures.mjs" <<NODE
import { readFileSync, writeFileSync } from 'node:fs';
import { parseEventPage, parseListingPage, toDraftRow } from '$ROOT/scout/src/parsers/smoothcomp.js';

const FIXDIR = '$ROOT/scout/test/fixtures/smoothcomp';
const report = (pass, name) => console.log(JSON.stringify({ pass: Boolean(pass), name }));

// The proof that this parser cannot reach the network: patch the global
// fetch with a counter for this whole process, then assert it never moved
// off zero, no matter which fixture (including the malformed one) ran.
let fetchCalls = 0;
globalThis.fetch = () => { fetchCalls += 1; throw new Error('unreachable: the parser must never call fetch'); };

function fx(name) { return readFileSync(FIXDIR + '/' + name, 'utf8'); }

function sqlStr(v) {
  if (v === null || v === undefined) return 'NULL';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

const NUMERIC_COLS = ['gi', 'nogi', 'kids', 'source_tier'];
const COLS = [
  'id', 'event_type', 'name', 'organizer_name', 'start_date', 'end_date', 'venue_name', 'address',
  'city', 'state', 'country', 'registration_url', 'registration_deadline', 'gi', 'nogi', 'kids',
  'source_url', 'source_host', 'source_event_ref', 'source_tier', 'dedupe_key',
];

// Every fixture is hand-written synthetic HTML: invented event names, dates,
// venues and ids ("Fixture ...", "Testburg"). None is a real Smoothcomp page.
const CASES = [
  { file: 'complete-event.html', url: 'https://smoothcomp.com/en/event/900001/fixture-open-2027', expect: 'ok' },
  { file: 'missing-registration.html', url: 'https://smoothcomp.com/en/event/900002/fixture-spring-open', expect: 'ok' },
  { file: 'missing-required-field.html', url: 'https://smoothcomp.com/en/event/900003/fixture-no-city-open', expect: 'reject' },
  { file: 'date-range.html', url: 'https://smoothcomp.com/en/event/900004/fixture-summer-camp-open', expect: 'ok' },
  { file: 'impossible-date.html', url: 'https://smoothcomp.com/en/event/900005/fixture-impossible-date-open', expect: 'reject' },
  { file: 'malformed-truncated.html', url: 'https://smoothcomp.com/en/event/900007/fixture-truncated-open', expect: 'reject' },
  { file: 'script-and-quotes.html', url: 'https://smoothcomp.com/en/event/900008/fixture-grapplers-cup', expect: 'ok' },
];

const inserts = [];
const okNames = [];
const rejectFiles = [];
let firstRow = null;

for (const c of CASES) {
  const result = parseEventPage(fx(c.file), { url: c.url });
  if (c.expect === 'ok') {
    report(result.ok === true, c.file + ': parses as ok: true');
    if (result.ok) {
      const row = toDraftRow(result.event);
      if (!firstRow) firstRow = row;
      okNames.push(row.name);
      const vals = COLS.map((col) => (NUMERIC_COLS.includes(col) ? String(row[col]) : sqlStr(row[col])));
      inserts.push('INSERT INTO events (' + COLS.join(', ') + ') VALUES (' + vals.join(', ') + ');');
    }
  } else {
    report(result.ok === false, c.file + ': parses as ok: false (rejected, not a half-built row)');
    report(typeof result.reason === 'string' && result.reason.length > 0, c.file + ': rejection carries a plain-English reason');
    if (!result.ok) rejectFiles.push(c.file);
  }
}

const listing = parseListingPage(fx('listing-mixed.html'), { url: 'https://smoothcomp.com/en/events' });
report(
  listing.eventUrls.length === 3 && listing.dropped.length >= 9,
  'listing-mixed.html: only allowed event-detail links survive (3), every exclusion is reported with a reason',
);

report(fetchCalls === 0, 'no fixture parse ever touched fetch: the network call counter stayed 0');

writeFileSync('$TMP/draft-rows.sql', inserts.join('\n') + '\n');

// A second attempt at the SAME candidate (a fresh id, the identical
// dedupe_key), to prove the database's own unique constraint refuses a
// repeat, not just this script's own bookkeeping.
const dupVals = COLS.map((col) => {
  if (col === 'id') return sqlStr('duplicate-attempt-id');
  return NUMERIC_COLS.includes(col) ? String(firstRow[col]) : sqlStr(firstRow[col]);
});
writeFileSync('$TMP/duplicate-row.sql', 'INSERT INTO events (' + COLS.join(', ') + ') VALUES (' + dupVals.join(', ') + ');\n');
writeFileSync('$TMP/summary.json', JSON.stringify({ okCount: okNames.length, rejectCount: rejectFiles.length, okNames }));
NODE

while IFS= read -r line; do
  p=$(echo "$line" | jq -r '.pass' 2>/dev/null)
  n=$(echo "$line" | jq -r '.name' 2>/dev/null)
  [ -z "$n" ] && { bad "phase A produced unreadable output: $line"; continue; }
  if [ "$p" = "true" ]; then ok "$n"; else bad "$n"; fi
done < <(node "$TMP/parse-fixtures.mjs")

if [ ! -s "$TMP/summary.json" ]; then
  bad "phase A did not produce a summary; aborting before touching the database"
  echo "== result: $PASS passed, $FAIL failed"
  exit 2
fi
OK_COUNT=$(jq -r '.okCount' "$TMP/summary.json")
REJECT_COUNT=$(jq -r '.rejectCount' "$TMP/summary.json")

echo "== phase B: applying the accepted rows to the real schema ($OK_COUNT accepted, $REJECT_COUNT rejected by the parser and never sent to the database)"
INSERT_OUT=$(d1file "$TMP/draft-rows.sql")
if echo "$INSERT_OUT" | grep -qi "error"; then
  bad "the database refused at least one row the parser called valid (no CHECK or trigger refusal expected)"
  echo "$INSERT_OUT" | tail -20
else
  ok "the database accepts every row the parser calls valid (no CHECK or trigger refusal)"
fi

ROWS_JSON=$(d1json "SELECT status, source_tier, source_host, count(*) AS n FROM events GROUP BY status, source_tier, source_host")
DRAFT_N=$(echo "$ROWS_JSON" | jq -r '[.[0].results[] | select(.status == "draft" and .source_tier == 1 and .source_host == "smoothcomp.com") | .n] | add // 0')
if [ "$DRAFT_N" = "$OK_COUNT" ]; then
  ok "every inserted row lands as status = draft, source_tier = 1, source_host = smoothcomp.com ($DRAFT_N of $OK_COUNT), never approved"
else
  bad "expected $OK_COUNT rows as draft/tier-1/smoothcomp.com, found $DRAFT_N"
  echo "$ROWS_JSON"
fi

APPROVED_N=$(d1json "SELECT count(*) AS n FROM events WHERE status <> 'draft'" | jq -r '.[0].results[0].n')
if [ "$APPROVED_N" = "0" ]; then
  ok "nothing this battery inserted is approved, or in any status but draft"
else
  bad "found $APPROVED_N row(s) not in draft status; automatic approval must never happen here"
fi

TOTAL_N=$(d1json "SELECT count(*) AS n FROM events" | jq -r '.[0].results[0].n')
if [ "$TOTAL_N" = "$OK_COUNT" ]; then
  ok "exactly the $OK_COUNT parser-accepted rows exist; the $REJECT_COUNT parser-rejected fixtures were never inserted"
else
  bad "expected exactly $OK_COUNT rows in events (the accepted fixtures only), found $TOTAL_N"
fi

echo "== phase B continued: the same candidate a second time is refused by the dedupe key"
DUP_OUT=$(d1file "$TMP/duplicate-row.sql")
if echo "$DUP_OUT" | grep -qi "event already exists"; then
  ok "inserting the same fixture twice is refused by the dedupe key (event already exists; update it instead)"
else
  bad "a duplicate insert was not refused as expected"
  echo "$DUP_OUT" | tail -20
fi
TOTAL_AFTER_DUP=$(d1json "SELECT count(*) AS n FROM events" | jq -r '.[0].results[0].n')
if [ "$TOTAL_AFTER_DUP" = "$OK_COUNT" ]; then
  ok "the refused duplicate left no trace: the row count is still $OK_COUNT"
else
  bad "row count changed after a refused duplicate insert: $TOTAL_AFTER_DUP, expected $OK_COUNT"
fi

echo "== result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
