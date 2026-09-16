#!/usr/bin/env bash
# ALMANAC console API battery. Runs the real Worker with `wrangler dev` against
# THROWAWAY local databases (never Cloudflare), and proves each rule by trying
# to break it:
#   - count headline, add, validation, duplicate refusal
#   - plain A refused on unconfirmed rows; Shift+A (deliberate) accepted
#   - plain A accepted when every critical field is green
#   - reject needs a reason; undo reaches the last five decisions only
#   - duplicates: distinct and merge
#   - edit writes a review_log edit row
#   - cross-site POSTs refused; non-reviewers refused
#   - production settings never accept the local dev identity
#   - a database with no environment marker refuses every write
#
#   bash scripts/verify-console.sh

set -uo pipefail
cd "$(dirname "$0")/.."
export CI=true

CFG=console/wrangler.toml
WR=(npx wrangler)
TMP=$(mktemp -d)
P1="$TMP/main"; P2="$TMP/nomarker"
PIDS=()
PASS=0; FAIL=0
REVIEWER="verify-reviewer@example.com"

cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; wait 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT

ok()   { PASS=$((PASS+1)); echo "PASS  $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL  $1"; }

d1() { "${WR[@]}" d1 execute almanac-console-test --local --env test --config "$CFG" --persist-to "$1" --command "$2" >/dev/null 2>&1; }
d1v() { "${WR[@]}" d1 execute almanac-console-test --local --env test --config "$CFG" --persist-to "$1" --json --command "$2" 2>/dev/null | sed -n '/^\[/,$p' | jq -r '.[0].results[0].v'; }

start() { # port persist extra-vars...
  local port=$1 persist=$2; shift 2
  "${WR[@]}" dev --config "$CFG" --env test --local --port "$port" --persist-to "$persist" --show-interactive-dev-session=false "$@" >"$TMP/dev-$port.log" 2>&1 &
  PIDS+=($!)
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null "http://localhost:$port/api/session"; then return 0; fi
    sleep 1
  done
  echo "server on $port did not start"; tail -20 "$TMP/dev-$port.log"; exit 2
}

# req METHOD PORT PATH [JSON] [extra curl args...] -> sets CODE and BODY
req() {
  local method=$1 port=$2 path=$3 data=${4:-}; shift 4 2>/dev/null || shift $#
  local args=(-s -o "$TMP/body" -w "%{http_code}" -X "$method" "http://localhost:$port$path")
  if [ "$method" = "POST" ]; then
    args+=(-H "Content-Type: application/json" -H "X-Almanac-Request: 1" -H "Origin: http://localhost:$port" --data "$data")
  fi
  CODE=$(curl "${args[@]}" "$@")
  BODY=$(cat "$TMP/body")
}
jqv() { echo "$BODY" | jq -r "$1"; }
expect() { # name code [jq-expr expected]
  local name=$1 code=$2
  if [ "$CODE" != "$code" ]; then bad "$name (HTTP $CODE, wanted $code: $(echo "$BODY" | head -c 200))"; return; fi
  if [ $# -ge 4 ]; then
    local got; got=$(jqv "$3")
    if [ "$got" != "$4" ]; then bad "$name ($3 = $got, wanted $4)"; return; fi
  fi
  ok "$name"
}

event_json() { # name date city [extra json fields]
  local extra=${4:-}
  printf '{"event_type":"tournament","name":"%s","start_date":"%s","city":"%s","state":"MO","country":"US","registration_url":"https://example.com/register/%s","source_url":"https://example.com/event/%s","gi":true%s}' \
    "$1" "$2" "$3" "$RANDOM" "$RANDOM" "$extra"
}

echo "== preparing throwaway local databases"
for P in "$P1" "$P2"; do
  "${WR[@]}" d1 migrations apply almanac-console-test --local --env test --config "$CFG" --persist-to "$P" 2>&1 | grep -E "✅|ERROR" | head -3
  d1 "$P" "INSERT INTO reviewers (email, role) VALUES ('$REVIEWER', 'admin')"
done
d1 "$P1" "INSERT INTO environment_marker (id, name) VALUES (1, 'staging')"   # P2 deliberately has no marker

start 8799 "$P1" --var ALLOW_DEV_IDENTITY:true --var DEV_ACCESS_EMAIL:$REVIEWER
M=8799

echo "== session, badge source, count headline"
req GET $M /api/session
expect "session via local dev identity" 200 '.via' 'dev'
expect "badge reads STAGING from the database marker" 200 '.environment.database + "/" + (.environment.match|tostring)' 'staging/true'
req GET $M /api/overview
expect "empty queue headline" 200 '.queue.headline' 'Nothing to review'

echo "== cross-site protection"
CODE=$(curl -s -o "$TMP/body" -w "%{http_code}" -X POST "http://localhost:$M/api/events" -H "Content-Type: application/json" --data "$(event_json 'No Header Open' 2027-03-06 Springfield)"); BODY=$(cat "$TMP/body")
expect "POST without X-Almanac-Request refused" 403
CODE=$(curl -s -o "$TMP/body" -w "%{http_code}" -X POST "http://localhost:$M/api/events" -H "Content-Type: application/json" -H "X-Almanac-Request: 1" -H "Origin: https://evil.example" --data "$(event_json 'Evil Open' 2027-03-06 Springfield)"); BODY=$(cat "$TMP/body")
expect "POST from a foreign origin refused" 403

echo "== add event"
req POST $M /api/events '{"event_type":"tournament","name":"Bad Date Open","start_date":"2027-02-30","city":"Springfield","state":"MO","country":"US","source_url":"https://example.com/e"}'
expect "impossible date refused with a field message" 400 '.fields.start_date != null' 'true'
req POST $M /api/events "$(event_json 'Verify Open' 2027-03-06 Springfield)"
expect "hand entry saved to the queue" 201 '.status' 'needs_review'
E1=$(jqv .id)
req GET $M /api/overview
expect "one row headline" 200 '.queue.headline' '1 row, about 1 minute'
req POST $M /api/events "$(event_json 'Verify Open' 2027-03-06 Springfield)"
expect "same name, date and place refused" 409

echo "== Shift+A gate"
req GET $M /api/events/$E1
expect "hand entry needs a deliberate approval" 200 '.eligibility.plain' 'false'
req POST $M /api/events/$E1/decision '{"decision":"approve","deliberate":false}'
expect "plain A refused on an unconfirmed row" 409 '.error' 'Deliberate approval required (Shift+A)'
req POST $M /api/events/$E1/decision '{"decision":"approve","deliberate":true}'
expect "Shift+A approves" 200 '.status' 'approved'
req GET $M /api/overview
expect "approved and upcoming count" 200 '.strip.approved_upcoming' '1'

echo "== undo and reject"
req GET $M /api/decisions/recent
expect "recent decision listed and undoable" 200 '.decisions[0].undoable' 'true'
LOG=$(jqv '.decisions[0].log_id')
req POST $M /api/decisions/undo "{\"log_id\":$LOG}"
expect "undo returns the row to the queue" 200 '.status' 'needs_review'
req POST $M /api/events/$E1/decision '{"decision":"reject"}'
expect "reject without a reason refused" 400
req POST $M /api/events/$E1/decision '{"decision":"reject","reason":2}'
expect "reject with reason 2 (wrong date)" 200 '.reason' 'wrong_date'
req GET $M /api/decisions/recent
req POST $M /api/decisions/undo "{\"log_id\":$(jqv '.decisions[0].log_id')}"
expect "undo a rejection" 200 '.status' 'needs_review'

echo "== plain A when every critical field is green"
REG=$(req GET $M /api/events/$E1; jqv .event.registration_url)
d1 "$P1" "INSERT INTO row_signals (entity_type, entity_id, signal, passed, evidence) VALUES ('event','$E1','grounding',1,'{\"field\":\"name\",\"value\":\"Verify Open\"}'), ('event','$E1','grounding',1,'{\"field\":\"start_date\",\"value\":\"2027-03-06\"}'), ('event','$E1','grounding',1,'{\"field\":\"location\",\"value\":\"Springfield, MO, US\"}'), ('event','$E1','link_live',1,'{\"url\":\"$REG\"}')"
req GET $M /api/events/$E1
expect "all critical fields green" 200 '.eligibility.plain' 'true'
req POST $M /api/events/$E1/decision '{"decision":"approve","deliberate":false}'
expect "plain A approves a confirmed row" 200 '.status' 'approved'
req GET $M /api/decisions/recent
req POST $M /api/decisions/undo "{\"log_id\":$(jqv '.decisions[0].log_id')}"
expect "undo plain approval" 200 '.status' 'needs_review'

echo "== duplicates"
req POST $M /api/events "$(event_json 'Verify Open Kids' 2027-03-06 Springfield)"
E2=$(jqv .id)
req GET $M /api/events/$E2
expect "possible duplicate flagged" 200 '.duplicates.unresolved | length' '1'
d1 "$P1" "INSERT INTO row_signals (entity_type, entity_id, signal, passed, evidence) VALUES ('event','$E2','grounding',1,'{\"field\":\"name\",\"value\":\"Verify Open Kids\"}'), ('event','$E2','grounding',1,'{\"field\":\"start_date\",\"value\":\"2027-03-06\"}'), ('event','$E2','grounding',1,'{\"field\":\"location\",\"value\":\"Springfield, MO, US\"}'), ('event','$E2','link_live',1,'{\"url\":\"$(jqv .event.registration_url)\"}')"
req POST $M /api/events/$E2/decision '{"decision":"approve","deliberate":false}'
expect "plain A refused while a duplicate is open" 409
req POST $M /api/events/$E2/duplicate '{"action":"distinct"}'
expect "mark distinct" 200
req GET $M /api/events/$E2
expect "duplicate cleared after distinct" 200 '.eligibility.plain' 'true'
req POST $M /api/events "$(event_json 'Verify Open Springfield' 2027-03-07 Springfield)"
E3=$(jqv .id)
req POST $M /api/events/$E3/duplicate "{\"action\":\"merge\",\"into\":\"$E1\"}"
expect "merge rejects the row as a duplicate" 200 '.status' 'rejected'

echo "== edit"
req POST $M /api/events/$E2/edit '{"name":"Verify Open Juniors"}'
expect "edit saves and names the changed field" 200 '.changed[0]' 'name'
req GET $M /api/events/$E2
expect "edited name turns its chip grey" 200 '.chips.name' 'grey'
req POST $M /api/events/$E2/edit '{"start_date":"2027-13-01"}'
expect "edit with an impossible date refused" 400

echo "== undo reaches the last five decisions only"
IDS=()
for i in 1 2 3 4 5 6; do
  req POST $M /api/events "$(event_json "Batch Open $i" 2027-0$((i+3))-1$i "Town$i")"
  IDS+=("$(jqv .id)")
done
for id in "${IDS[@]}"; do req POST $M /api/events/$id/decision '{"decision":"approve","deliberate":true}'; done
req GET $M /api/decisions/recent
expect "undo list shows five" 200 '.decisions | length' '5'
FIFTH=$(jqv '.decisions[4].log_id')
req POST $M /api/decisions/undo "{\"log_id\":$FIFTH}"
expect "undo the fifth most recent" 200 '.status' 'needs_review'
# The approval of the FIRST batch row is a real, still-current decision, but it
# is now the sixth most recent (the undo above added a transition that is not a
# decision), so it must be refused with the five-decision message.
SIXTH=$(d1v "$P1" "SELECT id AS v FROM review_log WHERE entity_id = '${IDS[0]}' AND action = 'transition' AND to_status = 'approved' ORDER BY id DESC LIMIT 1")
SIXTH_STATUS=$(d1v "$P1" "SELECT status AS v FROM events WHERE id = '${IDS[0]}'")
req POST $M /api/decisions/undo "{\"log_id\":$SIXTH}"
if [ "$SIXTH_STATUS" = "approved" ]; then
  expect "a real decision outside the last five is refused" 409 '.error' 'Only your last five decisions can be undone'
else
  bad "test setup: first batch row should still be approved (is $SIXTH_STATUS)"
fi

echo "== twelve rows headline"
for i in $(seq 1 12); do
  req GET $M /api/overview
  [ "$(jqv '.queue.rows | length')" -ge 12 ] && break
  req POST $M /api/events "$(event_json "Fill Open $i" 2027-11-1$((i%9)) "Fill$i")"
done
d1 "$P1" "SELECT 1"
req GET $M /api/overview
N=$(jqv '.queue.rows | length')
if [ "$N" = "12" ]; then expect "twelve rows headline" 200 '.queue.headline' '12 rows, about 4 minutes'; else bad "test setup: queue has $N rows, wanted 12"; fi

echo "== a row with no registration link (the founder's case, 2026-09-15)"
req POST $M /api/events '{"event_type":"tournament","name":"Fake event","start_date":"2026-10-09","end_date":"2026-10-10","city":"st louis","state":"MO","country":"US","source_url":"https://example.com/fake"}'
expect "row without a registration link still saves" 201
NOLINK=$(jqv .id)
req POST $M /api/events/$NOLINK/decision '{"decision":"approve","deliberate":true}'
expect "Shift+A refused, and the message says what to do" 409 '.error' 'This event has no registration link, and an approved event must have one (https). Press E to add the link, or R then 4 to reject it as a bad link.'
req POST $M /api/events/$NOLINK/decision '{"decision":"approve","deliberate":false}'
expect "plain A refused with the same message" 409 '.error' 'This event has no registration link, and an approved event must have one (https). Press E to add the link, or R then 4 to reject it as a bad link.'
req POST $M /api/events/$NOLINK/edit '{"registration_url":"https://example.com/register/fake"}'
expect "E adds the registration link" 200 '.changed[0]' 'registration_url'
req POST $M /api/events/$NOLINK/decision '{"decision":"approve","deliberate":true}'
expect "Shift+A approves once the link is there" 200 '.status' 'approved'
req GET $M /api/decisions/recent
req POST $M /api/decisions/undo "{\"log_id\":$(jqv '.decisions[0].log_id')}" >/dev/null
req POST $M /api/events/$NOLINK/decision '{"decision":"reject","reason":4}'
expect "or reject it as a bad link" 200 '.reason' 'bad_link'

echo "== static headers"
HDR=$(curl -s -D - -o /dev/null "http://localhost:$M/")
if echo "$HDR" | grep -qi "content-security-policy: default-src 'self'"; then ok "console page sends a strict Content-Security-Policy"; else bad "no CSP header on the console page"; fi

echo "== identity refusals"
start 8798 "$P1" --var ALLOW_DEV_IDENTITY:true --var DEV_ACCESS_EMAIL:stranger@example.com
req GET 8798 /api/session
expect "a signed-in non-reviewer is told so" 200 '.reviewer' 'null'
req GET 8798 /api/overview
expect "a non-reviewer cannot read the queue" 403

start 8797 "$P1" --var ENVIRONMENT:production --var ALLOW_DEV_IDENTITY:true --var DEV_ACCESS_EMAIL:$REVIEWER
req GET 8797 /api/session
expect "production settings refuse the dev identity" 401
CODE=$(curl -s -o "$TMP/body" -w "%{http_code}" "http://localhost:8797/api/overview" -H "Cf-Access-Jwt-Assertion: eyJhbGciOiJSUzI1NiIsImtpZCI6ImsxIn0.eyJlbWFpbCI6InZlcmlmeS1yZXZpZXdlckBleGFtcGxlLmNvbSJ9.forged"); BODY=$(cat "$TMP/body")
expect "production refuses a forged Access token" 401

echo "== environment marker"
start 8796 "$P2" --var ALLOW_DEV_IDENTITY:true --var DEV_ACCESS_EMAIL:$REVIEWER
req GET 8796 /api/session
expect "no marker: session reports a mismatch" 200 '.environment.match' 'false'
req POST 8796 /api/events "$(event_json 'Unmarked Open' 2027-03-06 Springfield)"
expect "no marker: every write refused" 409

echo "== result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
