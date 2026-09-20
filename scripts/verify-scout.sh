#!/usr/bin/env bash
# ALMANAC scout integration battery, rewritten 2026-09-19 for the real
# multi-phase crawl (robots re-check -> discovery -> ingest -> link-check)
# that superseded the old disabledFetch skeleton this script used to
# verify. The Opus adversarial review (2026-09-19) found that the
# skeleton-era version of this script had never been re-run against the
# rewrite: `runCrawlCycle`'s very first database write used component
# values ('scout_discovery' etc.) the crawl_runs table's own CHECK
# constraint rejects, so the real Worker entry point had never actually
# executed against the real schema even once. This script now proves it
# does, on the actual `scheduled()` handler, against a fresh migration
# apply, with SCOUT_ENABLED honored exactly as production would.
#
# Runs against a THROWAWAY LOCAL D1 only (never Cloudflare, never a
# remote database). Today's REAL state (checked directly against
# staging/production before this rewrite) is zero active source_aliases
# anywhere -- no organizer subdomain has been through the human
# terms-review step ARCHITECTURE.md section 9 rule 5 requires. This
# script seeds exactly that real shape (one fully-reviewed, active
# source; zero active aliases) rather than a synthetic best case, so a
# green run here is an honest proof of what the first real scheduled run
# will actually do: nothing fails, four crawl_runs rows close out
# 'succeeded' with real, valid component values, and every count is
# honestly zero because there is nothing yet to crawl.
#
#   bash scripts/verify-scout.sh

set -uo pipefail
cd "$(dirname "$0")/.."
export CI=true
ROOT=$(pwd)

CFG=console/wrangler.toml
DB_NAME=almanac-console-test
WR=(npx wrangler)
TMP=$(mktemp -d)
PIDS=()
PASS=0; FAIL=0
REVIEWER="verify-reviewer@example.com"
SHA64="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; wait 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT

ok()  { PASS=$((PASS+1)); echo "PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL  $1"; }

d1() { # command
  local out
  if ! out=$("${WR[@]}" d1 execute "$DB_NAME" --local --env test --config "$CFG" --persist-to "$TMP/db" --command "$1" 2>&1); then
    bad "setup step failed: $1"; echo "$out" | tail -5
  fi
}
d1json() { # command -> stdout (json)
  "${WR[@]}" d1 execute "$DB_NAME" --local --env test --config "$CFG" --persist-to "$TMP/db" --json --command "$1" 2>/dev/null | sed -n '/^\[/,$p'
}

echo "== preparing a throwaway local D1 (migrations from migrations/, applied fresh)"
"${WR[@]}" d1 migrations apply "$DB_NAME" --local --env test --config "$CFG" --persist-to "$TMP/db" 2>&1 | grep -E "✅|ERROR" | head -10
d1 "INSERT INTO reviewers (email, role) VALUES ('$REVIEWER', 'admin')"

echo "== seeding today's REAL shape: one fully-reviewed, active Tier 1 source, ZERO active aliases"
d1 "INSERT INTO sources (id, host, tier, page_types, terms_url, terms_last_updated, terms_read_on, terms_automated_access, terms_reuse, login_required, official_api, excluded_paths, robots_disallowed, robots_crawl_delay_seconds, robots_sha256, robots_read_on, verdict, verdict_conditions, reviewed_by, reviewed_on, active)
    VALUES ('src-smoothcomp', 'smoothcomp.com', 1, '[\"events\"]', 'https://smoothcomp.com/en/agreements', '2026-01-01', '2026-09-16', 'none found', 'none found', 0, 'none', '[]', '[]', 10, '$SHA64', '2026-09-16', 'allowed_with_conditions', 'public listing/detail pages only', '$REVIEWER', '2026-09-16', 1)"

d1json "SELECT * FROM sources ORDER BY id" > "$TMP/sources.json"
if [ ! -s "$TMP/sources.json" ]; then bad "could not read sources back from D1"; echo "== result: $PASS passed, $FAIL failed"; exit 2; fi

echo "== phase A: the gate, against the real row, with no fetch in reach"
cat > "$TMP/gate-check.mjs" <<NODE
import { readFileSync } from 'node:fs';
import { checkSource } from '$ROOT/scout/src/gate.js';

const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'))[0].results;
const byHost = Object.fromEntries(rows.map((r) => [r.host, r]));
const report = (pass, name) => console.log(JSON.stringify({ pass: Boolean(pass), name }));

const allowed = checkSource(byHost['smoothcomp.com']);
report(allowed.allowed === true, 'the one seeded source passes the gate: ' + JSON.stringify(allowed));
NODE
while IFS= read -r line; do
  p=$(echo "$line" | jq -r '.pass' 2>/dev/null)
  n=$(echo "$line" | jq -r '.name' 2>/dev/null)
  [ -z "$n" ] && { bad "phase A produced unreadable output: $line"; continue; }
  if [ "$p" = "true" ]; then ok "$n"; else bad "$n"; fi
done < <(node "$TMP/gate-check.mjs" "$TMP/sources.json")

echo "== phase B: the real Worker, one full scheduled() crawl cycle, against the real migrated schema"
"${WR[@]}" dev scout/src/index.js --config "$CFG" --env test --local --port 18799 \
  --persist-to "$TMP/db" --var SCOUT_ENABLED:true --test-scheduled \
  --show-interactive-dev-session=false >"$TMP/scout-dev.log" 2>&1 &
PIDS+=($!)
UP=""
for _ in $(seq 1 60); do
  if curl -s -o /dev/null "http://localhost:18799/"; then UP=1; break; fi
  sleep 1
done
if [ -z "$UP" ]; then bad "scout dev server did not start"; tail -40 "$TMP/scout-dev.log"; echo "== result: $PASS passed, $FAIL failed"; exit 2; fi

curl -s -o /dev/null "http://localhost:18799/__scheduled"

RUN_JSON=""
for _ in $(seq 1 30); do
  RUN_JSON=$(d1json "SELECT id, component, region, status, pages_fetched, errors, hosts_skipped, started_at FROM crawl_runs ORDER BY started_at ASC")
  COUNT=$(echo "$RUN_JSON" | jq -r '.[0].results | length' 2>/dev/null)
  RUNNING=$(echo "$RUN_JSON" | jq -r '[.[0].results[] | select(.status=="running")] | length' 2>/dev/null)
  if [ "${COUNT:-0}" -ge 4 ] && [ "${RUNNING:-1}" -eq 0 ]; then break; fi
  sleep 1
done

jv() { echo "$RUN_JSON" | jq -r "$1" 2>/dev/null; }
COUNT=$(jv '.[0].results | length')
if [ -z "$COUNT" ] || [ "$COUNT" -lt 4 ]; then
  bad "expected 4 crawl_runs rows (robots_check, discovery, ingest, link_checker), got ${COUNT:-0}"
  echo "$RUN_JSON"
  tail -60 "$TMP/scout-dev.log"
else
  ok "crawl_runs recorded all four phases of one real scheduled() cycle"
  REGIONS=$(jv '[.[0].results[].region] | @csv')
  [ "$REGIONS" = '"robots_check","discovery","ingest",' ] && ok "the four phases ran in the documented order: robots_check, discovery, ingest, link-check" \
    || bad "phase order/regions were $REGIONS, expected robots_check,discovery,ingest,(null)"

  BAD_COMPONENT=$(jv '[.[0].results[] | select((.component != "tier1_scout") and (.component != "link_checker"))] | length')
  [ "$BAD_COMPONENT" = "0" ] && ok "every crawl_runs row used a component value the schema's own CHECK actually permits (this is exactly what B4 broke)" \
    || bad "$BAD_COMPONENT row(s) used a component value outside the schema's CHECK -- runCrawlCycle is failing on its own first write again"

  FAILED_COUNT=$(jv '[.[0].results[] | select(.status != "succeeded")] | length')
  [ "$FAILED_COUNT" = "0" ] && ok "all four phases closed out status=succeeded -- runCrawlCycle executed end to end against the real schema without throwing" \
    || bad "$FAILED_COUNT phase(s) did not succeed"

  TOTAL_FETCHED=$(jv '[.[0].results[].pages_fetched] | add')
  [ "$TOTAL_FETCHED" = "0" ] && ok "zero pages fetched, honestly -- today's real database has zero active aliases, so this is what the real first run looks like" \
    || bad "expected 0 total pages_fetched with zero active aliases seeded, got $TOTAL_FETCHED"
fi

echo "== phase C: production's own two inertness gates, re-confirmed on the real config file"
# Only the PRODUCTION section (everything before the first [env.*] table)
# is checked here -- staging may carry its own SCOUT_ENABLED/[triggers]
# once the founder authorizes a real staging run; production's gates are
# the ones that may never move without his separate, explicit word.
PROD_SECTION=$(awk '/^\[env\./{exit} {print}' scout/wrangler.toml)
echo "$PROD_SECTION" | grep -q 'SCOUT_ENABLED = "false"' && ok "production's own SCOUT_ENABLED still defaults to false" || bad "production's own SCOUT_ENABLED default is not false"
echo "$PROD_SECTION" | grep -q '^\[triggers\]' && bad "a [triggers] section now exists in production's own config -- a cron trigger must never appear there without the founder's own explicit, separate step" \
  || ok "no [triggers] section exists in production's own config -- nothing schedules the production Worker"

echo "== result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
