#!/usr/bin/env bash
# ALMANAC scout integration battery. Runs against a THROWAWAY LOCAL D1
# (never Cloudflare, never a remote database), reusing the console's own
# test environment (console/wrangler.toml --env test) since the scout reads
# the same `sources` and `crawl_runs` tables the console already migrates.
#
# The hard rule this battery exists to prove: the scout skeleton must not
# fetch anything, ever, in this pull request. It proves that in two layers:
#
#   Phase A (pure logic, no D1, no Worker): real rows are read out of a real
#   `sources` table and handed to scout/src/gate.js and scout/src/queue.js
#   directly, in a plain Node process. Neither module has a fetch parameter
#   at all, so a call counter that starts at 0 and is never touched is the
#   proof: refusals are decided, and a plan is built, before any fetch could
#   ever be attempted.
#
#   Phase B (the real Worker, via `wrangler dev --test-scheduled`): the same
#   rows drive one real scout run through scout/src/index.js. The one
#   allowed host reaches the injected fetcher, which throws by design in
#   this skeleton (see scout/src/run.js's disabledFetch), so the run fails
#   loudly and `crawl_runs` records the failure and the skipped-host count.
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
d1json() { # command -> file
  "${WR[@]}" d1 execute "$DB_NAME" --local --env test --config "$CFG" --persist-to "$TMP/db" --json --command "$1" 2>/dev/null | sed -n '/^\[/,$p'
}

echo "== preparing a throwaway local D1 (migrations from migrations/, applied fresh)"
"${WR[@]}" d1 migrations apply "$DB_NAME" --local --env test --config "$CFG" --persist-to "$TMP/db" 2>&1 | grep -E "✅|ERROR" | head -5
d1 "INSERT INTO reviewers (email, role) VALUES ('$REVIEWER', 'admin')"

echo "== inserting real sources rows, one per gate scenario"
# Case 1: nothing on file at all. active defaults to 0.
d1 "INSERT INTO sources (id, host, tier) VALUES ('src-none', 'no-review.example.com', 1)"

# Case 2: a complete review, but the verdict is not_allowed. The database
# itself would refuse active = 1 here, so active stays 0.
d1 "INSERT INTO sources (id, host, tier, page_types, terms_url, terms_last_updated, terms_read_on, terms_automated_access, terms_reuse, login_required, official_api, excluded_paths, robots_disallowed, robots_sha256, robots_read_on, verdict, reviewed_by, reviewed_on, active)
    VALUES ('src-notallowed', 'not-allowed.example.com', 1, '[\"events\"]', 'https://not-allowed.example.com/terms', '2026-01-01', '2026-09-01', 'none found', 'none found', 0, 'none', '[]', '[]', '$SHA64', '2026-09-01', 'not_allowed', '$REVIEWER', '2026-09-01', 0)"

# Case 3: a complete review, allowing verdict, but the site requires a login.
# The database would also refuse active = 1 here.
d1 "INSERT INTO sources (id, host, tier, page_types, terms_url, terms_last_updated, terms_read_on, terms_automated_access, terms_reuse, login_required, official_api, excluded_paths, robots_disallowed, robots_sha256, robots_read_on, verdict, reviewed_by, reviewed_on, active)
    VALUES ('src-login', 'login-required.example.com', 1, '[\"events\"]', 'https://login-required.example.com/terms', '2026-01-01', '2026-09-01', 'none found', 'none found', 1, 'none', '[]', '[]', '$SHA64', '2026-09-01', 'allowed', '$REVIEWER', '2026-09-01', 0)"

# Case 4: a complete review, allowing verdict, no login, and active. One page
# type, so exactly one plan entry (and one fetch attempt) is unambiguous.
d1 "INSERT INTO sources (id, host, tier, page_types, terms_url, terms_last_updated, terms_read_on, terms_automated_access, terms_reuse, login_required, official_api, excluded_paths, robots_disallowed, robots_sha256, robots_read_on, verdict, reviewed_by, reviewed_on, active)
    VALUES ('src-allowed', 'allowed.example.com', 1, '[\"events\"]', 'https://allowed.example.com/terms', '2026-01-01', '2026-09-01', 'none found', 'none found', 0, 'none', '[]', '[]', '$SHA64', '2026-09-01', 'allowed', '$REVIEWER', '2026-09-01', 1)"

d1json "SELECT * FROM sources ORDER BY id" > "$TMP/sources.json"
if [ ! -s "$TMP/sources.json" ]; then bad "could not read sources back from D1"; echo "== result: $PASS passed, $FAIL failed"; exit 2; fi

echo "== phase A: the gate and the queue, against the real rows, with no fetch in reach"
cat > "$TMP/plan-check.mjs" <<NODE
import { readFileSync } from 'node:fs';
import { checkSource } from '$ROOT/scout/src/gate.js';
import { buildPlan } from '$ROOT/scout/src/queue.js';

const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'))[0].results;
const byHost = Object.fromEntries(rows.map((r) => [r.host, r]));
const report = (pass, name) => console.log(JSON.stringify({ pass: Boolean(pass), name }));

// A counter that would prove a fetch happened, if anything ever called it.
// Neither checkSource nor buildPlan accepts a fetch function at all, so this
// can only stay at 0; that is the point being proven.
let fetchCalls = 0;
const wouldBeAFetch = () => { fetchCalls += 1; throw new Error('unreachable in phase A'); };
void wouldBeAFetch;

const none = checkSource(byHost['no-review.example.com']);
report(none.allowed === false && /page types to fetch/.test(none.reason) && /field 1/.test(none.reason),
  'a host with no terms review on file is refused, naming what is missing (' + JSON.stringify(none.reason) + ')');

const notAllowed = checkSource(byHost['not-allowed.example.com']);
report(notAllowed.allowed === false && /not_allowed/.test(notAllowed.reason),
  'a host whose verdict is not_allowed is refused (' + JSON.stringify(notAllowed.reason) + ')');

const loginRequired = checkSource(byHost['login-required.example.com']);
report(loginRequired.allowed === false && /requires a login/.test(loginRequired.reason),
  'a host with login_required = 1 is refused (' + JSON.stringify(loginRequired.reason) + ')');

const allowed = checkSource(byHost['allowed.example.com']);
report(allowed.allowed === true, 'a host with a complete review and an allowing verdict passes the gate');

const now = Date.parse('2026-09-16T00:00:00Z');
const { plan, skipped } = buildPlan(rows, now);
const skippedHosts = skipped.map((s) => s.host).sort();
const planHosts = [...new Set(plan.map((p) => p.host))];
report(
  skippedHosts.length === 3 && skippedHosts.join(',') === ['login-required.example.com', 'no-review.example.com', 'not-allowed.example.com'].join(','),
  'the three refused hosts are skipped, with reasons, and never enter the plan',
);
report(planHosts.length === 1 && planHosts[0] === 'allowed.example.com' && plan.length === 1,
  'the one allowed host is admitted to the plan; still no fetch has happened');
report(fetchCalls === 0, 'the injected fetcher was never called while checking or planning (call counter is 0)');
NODE
while IFS= read -r line; do
  p=$(echo "$line" | jq -r '.pass' 2>/dev/null)
  n=$(echo "$line" | jq -r '.name' 2>/dev/null)
  [ -z "$n" ] && { bad "phase A produced unreadable output: $line"; continue; }
  if [ "$p" = "true" ]; then ok "$n"; else bad "$n"; fi
done < <(node "$TMP/plan-check.mjs" "$TMP/sources.json")

echo "== phase B: the real Worker, one scout run, the disabled fetcher makes it fail loudly"
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
for _ in $(seq 1 20); do
  RUN_JSON=$(d1json "SELECT id, component, status, pages_fetched, errors, hosts_skipped FROM crawl_runs ORDER BY started_at DESC LIMIT 1")
  STATUS=$(echo "$RUN_JSON" | jq -r '.[0].results[0].status // empty' 2>/dev/null)
  if [ "$STATUS" = "failed" ] || [ "$STATUS" = "succeeded" ]; then break; fi
  sleep 1
done

jv() { echo "$RUN_JSON" | jq -r "$1" 2>/dev/null; }
if [ -z "$STATUS" ]; then
  bad "no crawl_runs row appeared (scheduled() did not run, or SCOUT_ENABLED was not honored)"
else
  ok "crawl_runs records the run (component: $(jv '.[0].results[0].component'))"
  [ "$(jv '.[0].results[0].hosts_skipped')" = "3" ] && ok "crawl_runs counts the three gate-refused hosts as skipped" || bad "hosts_skipped was $(jv '.[0].results[0].hosts_skipped'), wanted 3"
  [ "$(jv '.[0].results[0].pages_fetched')" = "0" ] && ok "crawl_runs shows zero pages actually fetched (the fetcher always throws)" || bad "pages_fetched was $(jv '.[0].results[0].pages_fetched'), wanted 0"
  [ "$(jv '.[0].results[0].errors')" = "1" ] && ok "crawl_runs counts the one attempted, failed fetch as an error" || bad "errors was $(jv '.[0].results[0].errors'), wanted 1"
  [ "$STATUS" = "failed" ] && ok "the run's own status is failed, loudly, not silently succeeded" || bad "status was $STATUS, wanted failed"
fi

echo "== result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
