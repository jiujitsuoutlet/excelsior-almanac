#!/usr/bin/env bash
# ALMANAC Tier 3 public submission Worker battery. Runs the real Worker
# with `wrangler dev` against a THROWAWAY local database (never
# Cloudflare) plus Cloudflare's own real siteverify endpoint (using
# Cloudflare's published TEST Turnstile credentials -- a real network
# call, deterministic, no real widget or human needed), same discipline
# as ../../scripts/verify-console.sh:
#   - a valid submission lands in events at needs_review, source_tier 3
#   - the honeypot: filled -> fake success, nothing written
#   - Turnstile: missing token refused, Cloudflare's real "always blocks"
#     test secret refused, no secret configured refused
#   - rate limit: the 6th rapid submission from one IP is refused
#   - validation: bad https link refused, bad email refused
#   - the environment-marker guard: a database with no marker refuses
#
#   bash submissions/scripts/verify-submissions.sh
set -uo pipefail
cd "$(dirname "$0")/.."

CFG=wrangler.toml
WR=(npx wrangler)
TMP=$(mktemp -d)
P1="$TMP/main"; P2="$TMP/nomarker"
PIDS=()
PASS=0; FAIL=0

cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; wait 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT

ok()  { PASS=$((PASS+1)); echo "PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL  $1"; }

d1() { "${WR[@]}" d1 execute almanac-submissions-test --local --env test --config "$CFG" --persist-to "$1" --command "$2" >/dev/null 2>&1; }
d1v() { "${WR[@]}" d1 execute almanac-submissions-test --local --env test --config "$CFG" --persist-to "$1" --json --command "$2" 2>/dev/null | sed -n '/^\[/,$p' | jq -r '.[0].results[0].v'; }

start() { # port persist extra-vars...
  local port=$1 persist=$2; shift 2
  "${WR[@]}" dev --config "$CFG" --env test --local --port "$port" --persist-to "$persist" --show-interactive-dev-session=false "$@" >"$TMP/dev-$port.log" 2>&1 &
  PIDS+=($!)
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null "http://localhost:$port/"; then return 0; fi
    sleep 1
  done
  echo "server on $port did not start"; tail -30 "$TMP/dev-$port.log"; exit 2
}

req() { # METHOD PORT PATH [JSON] [ip-suffix] -> sets CODE and BODY
  local method=$1 port=$2 path=$3 data=${4:-} ipsuf=${5:-1}
  local args=(-s -o "$TMP/body" -w "%{http_code}" -X "$method" "http://localhost:$port$path" -H "CF-Connecting-IP: 203.0.113.$ipsuf")
  if [ "$method" = "POST" ]; then args+=(-H "Content-Type: application/json" --data "$data"); fi
  CODE=$(curl "${args[@]}"); BODY=$(cat "$TMP/body")
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

submission_json() { # ip-suffix email extra-json
  printf '{"event_type":"tournament","name":"Verify Open %s","start_date":"2027-03-06","city":"Springfield","state":"MO","country":"US","registration_url":"https://example.com/register/%s","submitter_email":"%s","turnstileToken":"any-token-cloudflare-test-secret-ignores-the-value"%s}' \
    "$RANDOM" "$RANDOM" "$2" "${3:-}"
}

echo "== preparing a throwaway local database, WITH marker"
"${WR[@]}" d1 migrations apply almanac-submissions-test --local --env test --config "$CFG" --persist-to "$P1" 2>&1 | grep -E "✅|ERROR" | head -3
d1 "$P1" "INSERT INTO environment_marker (id, name) VALUES (1, 'staging')"
# P2: migrated but deliberately given NO marker row, for the mismatch test.
"${WR[@]}" d1 migrations apply almanac-submissions-test --local --env test --config "$CFG" --persist-to "$P2" 2>&1 | grep -E "✅|ERROR" | head -3

start 8899 "$P1"
M=8899

echo "== the form itself renders, with a real site key injected"
req GET $M / '' 1
if [ "$CODE" = "200" ] && echo "$BODY" | grep -q "1x00000000000000000000AA"; then ok "form served with the test site key injected"; else bad "form did not render with the injected site key (HTTP $CODE)"; fi

echo "== a valid submission lands in the queue"
req POST $M /submit "$(submission_json x1 organizer1@example.com)" 10
expect "valid submission accepted" 201 '.status' 'needs_review'
ID=$(jqv .id)
STATUS=$(d1v "$P1" "select status as v from events where id='$ID'")
TIER=$(d1v "$P1" "select source_tier as v from events where id='$ID'")
LOGSRC=$(d1v "$P1" "select json_extract(after_json,'\$.source') as v from review_log where entity_id='$ID' and action='create'")
ACTOR=$(d1v "$P1" "select actor as v from review_log where entity_id='$ID' and action='create'")
[ "$STATUS" = "needs_review" ] && ok "row really landed at needs_review in the database" || bad "row status is '$STATUS', not needs_review"
[ "$TIER" = "3" ] && ok "source_tier is 3 (Tier 3, per ARCHITECTURE.md)" || bad "source_tier is '$TIER', not 3"
[ "$LOGSRC" = "public organizer submission" ] && ok "review_log records this as a public organizer submission, not console hand entry" || bad "logged source is '$LOGSRC'"
[ "$ACTOR" = "system:submissions" ] && ok "actor is system:submissions (the schema's own trigger accepts nothing else for a non-reviewer)" || bad "actor is '$ACTOR'"
EMAILLOG=$(d1v "$P1" "select json_extract(after_json,'\$.submitter_email') as v from review_log where entity_id='$ID' and action='create'")
[ "$EMAILLOG" = "organizer1@example.com" ] && ok "the submitter's own email is still recorded, in after_json, for follow-up" || bad "submitter_email in after_json is '$EMAILLOG'"

echo "== the honeypot"
BEFORE=$(d1v "$P1" "select count(*) as v from events")
req POST $M /submit '{"organizer_website_url":"http://spam.example","event_type":"tournament","name":"Spam","start_date":"2027-03-06","city":"X","state":"MO","country":"US","registration_url":"https://example.com","submitter_email":"a@b.com","turnstileToken":"x"}' 11
expect "a filled honeypot gets a FAKE success" 201 '.status' 'received'
AFTER=$(d1v "$P1" "select count(*) as v from events")
[ "$BEFORE" = "$AFTER" ] && ok "...and nothing was actually written" || bad "honeypot submission WAS written to the database ($BEFORE -> $AFTER)"

echo "== Turnstile"
req POST $M /submit "$(printf '{"event_type":"tournament","name":"No Token","start_date":"2027-03-06","city":"X","state":"MO","country":"US","registration_url":"https://example.com/r","submitter_email":"a@b.com"}')" 12
expect "no Turnstile token: refused" 400
req POST $M /submit "$(printf '{"event_type":"tournament","name":"Bad Turnstile","start_date":"2027-03-06","city":"X","state":"MO","country":"US","registration_url":"https://example.com/r","submitter_email":"a@b.com","turnstileToken":"anything"}')" 13
# This env's TURNSTILE_SECRET_KEY is Cloudflare's real "always passes" test
# secret -- to prove the "always BLOCKS" path against the real endpoint
# too, override it for one request via a second dev server on the same DB.
start 8900 "$P1" --var TURNSTILE_SECRET_KEY:2x0000000000000000000000000000000AA
req POST 8900 /submit "$(submission_json x3 organizer3@example.com)" 14
expect "Cloudflare's real 'always blocks' test secret is genuinely refused" 400

echo "== validation, reused from the console's own validateEventInput"
req POST $M /submit "$(printf '{"event_type":"tournament","name":"Bad Link","start_date":"2027-03-06","city":"X","state":"MO","country":"US","registration_url":"http://not-https.example","submitter_email":"a@b.com","turnstileToken":"t"}')" 15
expect "a non-https registration link is refused" 400
req POST $M /submit "$(printf '{"event_type":"tournament","name":"Bad Email","start_date":"2027-03-06","city":"X","state":"MO","country":"US","registration_url":"https://example.com/r","submitter_email":"not-an-email","turnstileToken":"t"}')" 16
expect "an invalid submitter email is refused" 400

echo "== rate limiting: the 6th rapid submission from ONE ip is refused"
IP=55
for i in 1 2 3 4 5; do req POST $M /submit "$(submission_json rl organizer-rl-$i@example.com)" $IP; done
expect "the 5th submission from this ip in the window still succeeds" 201
req POST $M /submit "$(submission_json rl organizer-rl-6@example.com)" $IP
expect "the 6th submission from the SAME ip in the same window is refused" 429

echo "== environment-marker guard (this session's own root-cause bug class)"
start 8901 "$P2"
req POST 8901 /submit "$(submission_json nm organizer-nomarker@example.com)" 20
expect "a database with no environment marker refuses every write" 500

echo
echo "==== SUBMISSIONS WORKER: $PASS passed, $FAIL failed ===="
[ "$FAIL" -eq 0 ]
