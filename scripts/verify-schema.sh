#!/usr/bin/env bash
# ALMANAC schema verification battery.
#
#   bash scripts/verify-schema.sh local     # fresh local D1 under .wrangler/state
#   bash scripts/verify-schema.sh staging   # remote almanac-staging, restored afterwards
#
# Every rule the migration claims is tested by trying to break it. A refusal is
# the proof. Test rows use ids that start with "verify-". On staging, the script
# records a Time Travel bookmark before inserting test rows and restores it at
# the end, so staging returns to an empty, migrated database.
#
# Never run this against production.

set -uo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-}"
case "$TARGET" in
  local)   DB="almanac";         FLAGS=(--local) ;;
  staging) DB="almanac-staging"; FLAGS=(--remote --env staging); TT_FLAGS=(--env staging) ;;  # time-travel is always remote and rejects --remote
  *) echo "usage: bash scripts/verify-schema.sh local|staging"; exit 2 ;;
esac

if [ "$TARGET" = "staging" ]; then
  if [ ! -f .env ]; then echo ".env missing"; exit 2; fi
  set -a; source .env; set +a
fi

export CI=true
WR=(npx wrangler)
PASS=0
FAIL=0

sql() { "${WR[@]}" d1 execute "$DB" "${FLAGS[@]}" --json --command "$1" 2>&1; }

expect_ok() {
  local name="$1" q="$2" out
  if out=$(sql "$q"); then PASS=$((PASS+1)); echo "PASS  $name"
  else FAIL=$((FAIL+1)); echo "FAIL  $name (expected success)"; echo "$out" | grep -iE "error|constraint|abort" | head -3; fi
}

expect_refused() {
  local name="$1" needle="$2" q="$3" out
  if out=$(sql "$q"); then FAIL=$((FAIL+1)); echo "FAIL  $name (expected refusal, statement succeeded)"
  elif echo "$out" | grep -qiF "$needle"; then PASS=$((PASS+1)); echo "PASS  $name (refused: $needle)"
  else FAIL=$((FAIL+1)); echo "FAIL  $name (refused, but not with: $needle)"; echo "$out" | grep -iE "error" | head -3; fi
}

expect_value() {
  local name="$1" q="$2" want="$3" got
  got=$(sql "$q" | sed -n '/^\[/,$p' | jq -r '.[0].results[0].v // "null"' 2>/dev/null)
  if [ "$got" = "$want" ]; then PASS=$((PASS+1)); echo "PASS  $name (= $want)"
  else FAIL=$((FAIL+1)); echo "FAIL  $name (wanted $want, got $got)"; fi
}

echo "== target: $TARGET ($DB)"
if [ "$TARGET" = "local" ]; then
  rm -rf .wrangler/state
fi
"${WR[@]}" d1 migrations apply "$DB" "${FLAGS[@]}" 2>&1 | grep -E "✅|No migrations|ERROR" | head -5

BOOKMARK=""
if [ "$TARGET" = "staging" ]; then
  BOOKMARK=$("${WR[@]}" d1 time-travel info "$DB" "${TT_FLAGS[@]}" --json 2>/dev/null | sed -n '/^{/,$p' | jq -r '.bookmark')
  echo "== Time Travel bookmark before test rows: $BOOKMARK"
  if [ -z "$BOOKMARK" ] || [ "$BOOKMARK" = "null" ]; then echo "no bookmark; refusing to write test rows to staging"; exit 2; fi
fi

echo "== structure"
expect_value "15 ALMANAC tables exist" "SELECT count(*) AS v FROM sqlite_master WHERE type='table' AND name IN ('reviewers','sources','approval_rules','events','seminar_details','superfight_details','camp_details','competition_details','venues','venue_sessions','row_signals','review_log','status_transition_rules','coverage_requests','crawl_runs')" "15"
EXPECTED_TRIGGERS=$(grep -c "^CREATE TRIGGER" migrations/20260915000100_core_schema.sql)
expect_value "all $EXPECTED_TRIGGERS triggers exist" "SELECT count(*) AS v FROM sqlite_master WHERE type='trigger'" "$EXPECTED_TRIGGERS"
expect_value "34 transition rules seeded" "SELECT count(*) AS v FROM status_transition_rules" "34"
expect_value "no approval rule is enabled" "SELECT count(*) AS v FROM approval_rules WHERE enabled = 1" "0"
expect_refused "foreign keys enforced (session for a missing venue)" "FOREIGN KEY constraint failed" "INSERT INTO venue_sessions (id, venue_id, day_of_week, start_time, timezone, style, source_url, source_tier) VALUES ('verify-fk', 'no-such-venue', 1, '18:00', 'America/Chicago', 'gi', 'https://example.com/schedule', 1)"

echo "== setup rows"
expect_ok "insert active reviewer" "INSERT INTO reviewers (email, role) VALUES ('verify-reviewer@example.com', 'admin')"
expect_ok "insert inactive reviewer" "INSERT INTO reviewers (email, role, active) VALUES ('verify-inactive@example.com', 'reviewer', 0)"
expect_ok "insert draft event" "INSERT INTO events (id, event_type, name, start_date, city, state, country, registration_url, source_url, source_host, source_tier, dedupe_key) VALUES ('verify-e1', 'tournament', 'Verify Open', '2027-03-06', 'Springfield', 'MO', 'US', 'https://example.com/register', 'https://example.com/event', 'example.com', 1, 'verify-e1-key')"
expect_ok "insert draft venue" "INSERT INTO venues (id, name, city, state, country, source_url, source_host, source_tier, dedupe_key) VALUES ('verify-v1', 'Verify Academy', 'Salem', 'MO', 'US', 'https://example.com/academy', 'example.com', 1, 'verify-v1-key')"

echo "== rule 3: new rows start as draft"
expect_refused "insert an approved event" "new rows start as draft" "INSERT INTO events (id, event_type, name, start_date, city, state, country, source_url, source_host, source_tier, dedupe_key, status, approved_at) VALUES ('verify-e2', 'tournament', 'X', '2027-01-01', 'X', 'MO', 'US', 'https://x.test', 'x.test', 1, 'verify-e2-key', 'approved', '2026-01-01')"

echo "== rule 1: one path for status"
expect_refused "direct status update" "only through a review_log transition" "UPDATE events SET status = 'needs_review' WHERE id = 'verify-e1'"
expect_refused "direct approved_at update" "only through a review_log transition" "UPDATE events SET approved_at = '2026-09-15' WHERE id = 'verify-e1'"
expect_refused "transition not in the rules (draft to approved)" "transition is not allowed" "INSERT INTO review_log (entity_type, entity_id, action, from_status, to_status, actor) VALUES ('event', 'verify-e1', 'transition', 'draft', 'approved', 'verify-reviewer@example.com')"
expect_refused "from_status does not match current" "does not match the current status" "INSERT INTO review_log (entity_type, entity_id, action, from_status, to_status, actor) VALUES ('event', 'verify-e1', 'transition', 'needs_review', 'approved', 'verify-reviewer@example.com')"
expect_refused "inactive reviewer as actor" "not an active reviewer" "INSERT INTO review_log (entity_type, entity_id, action, from_status, to_status, actor) VALUES ('event', 'verify-e1', 'transition', 'draft', 'needs_review', 'verify-inactive@example.com')"
expect_refused "unknown person as actor" "not an active reviewer" "INSERT INTO review_log (entity_type, entity_id, action, from_status, to_status, actor) VALUES ('event', 'verify-e1', 'transition', 'draft', 'needs_review', 'someone@example.com')"
expect_ok "system moves draft to needs_review" "INSERT INTO review_log (entity_type, entity_id, action, from_status, to_status, actor) VALUES ('event', 'verify-e1', 'transition', 'draft', 'needs_review', 'system:tier1_scout')"
expect_value "status is now needs_review" "SELECT status AS v FROM events WHERE id = 'verify-e1'" "needs_review"

echo "== rule 5: automatic approval is off"
expect_refused "system approval without a rule" "automatic approval is off" "INSERT INTO review_log (entity_type, entity_id, action, from_status, to_status, actor) VALUES ('event', 'verify-e1', 'transition', 'needs_review', 'approved', 'system:tier1_scout')"
expect_refused "enable a rule without an amendment" "CHECK constraint failed" "INSERT INTO approval_rules (id, tier, enabled) VALUES ('verify_rule_v1', 1, 1)"
expect_ok "add a disabled rule" "INSERT INTO approval_rules (id, tier) VALUES ('verify_rule_v1', 1)"
expect_refused "system approval under a disabled rule" "automatic approval is off" "INSERT INTO review_log (entity_type, entity_id, action, from_status, to_status, actor, approval_rule) VALUES ('event', 'verify-e1', 'transition', 'needs_review', 'approved', 'system:tier1_scout', 'verify_rule_v1')"
expect_refused "human approval carrying a rule" "applies only to automatic approvals" "INSERT INTO review_log (entity_type, entity_id, action, from_status, to_status, actor, approval_rule) VALUES ('event', 'verify-e1', 'transition', 'needs_review', 'approved', 'verify-reviewer@example.com', 'verify_rule_v1')"
expect_ok "human approves" "INSERT INTO review_log (entity_type, entity_id, action, from_status, to_status, actor) VALUES ('event', 'verify-e1', 'transition', 'needs_review', 'approved', 'verify-reviewer@example.com')"
expect_value "status is now approved" "SELECT status AS v FROM events WHERE id = 'verify-e1'" "approved"
expect_value "approved_by is the reviewer" "SELECT approved_by AS v FROM events WHERE id = 'verify-e1'" "verify-reviewer@example.com"
expect_value "approved_at is set" "SELECT (approved_at IS NOT NULL) AS v FROM events WHERE id = 'verify-e1'" "1"

echo "== rule 4: approved content is locked"
expect_refused "edit an approved name" "approved content is locked" "UPDATE events SET name = 'Changed' WHERE id = 'verify-e1'"
expect_ok "non-content field on an approved row" "UPDATE events SET last_seen_at = '2026-09-15T00:00:00.000Z' WHERE id = 'verify-e1'"
expect_refused "direct status change after approval" "only through a review_log transition" "UPDATE events SET status = 'stale', approved_at = NULL, approved_by = NULL WHERE id = 'verify-e1'"
expect_refused "system takedown (approved to rejected)" "system actors cannot make this transition" "INSERT INTO review_log (entity_type, entity_id, action, from_status, to_status, actor, reason_code) VALUES ('event', 'verify-e1', 'transition', 'approved', 'rejected', 'system:link_checker', 'dead_link')"
expect_refused "reject without a reason" "CHECK constraint failed" "INSERT INTO review_log (entity_type, entity_id, action, from_status, to_status, actor) VALUES ('event', 'verify-e1', 'transition', 'approved', 'rejected', 'verify-reviewer@example.com')"
expect_ok "human demotes approved to needs_review" "INSERT INTO review_log (entity_type, entity_id, action, from_status, to_status, actor) VALUES ('event', 'verify-e1', 'transition', 'approved', 'needs_review', 'verify-reviewer@example.com')"
expect_ok "edit is allowed after demotion" "UPDATE events SET name = 'Verify Open 2027' WHERE id = 'verify-e1'"
expect_value "approval cleared on demotion" "SELECT (approved_by IS NULL AND approved_at IS NULL) AS v FROM events WHERE id = 'verify-e1'" "1"

echo "== rule 7 and the REPLACE path"
expect_refused "delete an event" "never deleted" "DELETE FROM events WHERE id = 'verify-e1'"
expect_refused "insert or replace an existing event" "already exists" "INSERT OR REPLACE INTO events (id, event_type, name, start_date, city, state, country, source_url, source_host, source_tier, dedupe_key) VALUES ('verify-e1', 'tournament', 'X', '2027-01-01', 'X', 'MO', 'US', 'https://x.test', 'x.test', 1, 'other-key')"
expect_refused "change an event id" "ids never change" "UPDATE events SET id = 'verify-e9' WHERE id = 'verify-e1'"
expect_refused "venues never expire" "transition is not allowed" "INSERT INTO review_log (entity_type, entity_id, action, from_status, to_status, actor) VALUES ('venue', 'verify-v1', 'transition', 'draft', 'expired', 'system:expiry')"

echo "== rule 2: append-only logs"
expect_refused "update review_log" "append-only" "UPDATE review_log SET actor = 'x' WHERE entity_id = 'verify-e1'"
expect_refused "delete review_log" "append-only" "DELETE FROM review_log WHERE entity_id = 'verify-e1'"
expect_refused "insert or replace over a review_log row" "append-only" "INSERT OR REPLACE INTO review_log (id, entity_type, entity_id, action, actor) SELECT min(id), 'event', 'verify-e1', 'edit', 'system:tier1_scout' FROM review_log WHERE entity_id = 'verify-e1'"
expect_ok "append a signal" "INSERT INTO row_signals (entity_type, entity_id, signal, passed, evidence) VALUES ('event', 'verify-e1', 'link_live', 1, '{\"status\":200}')"
expect_refused "update row_signals" "append-only" "UPDATE row_signals SET passed = 0 WHERE entity_id = 'verify-e1'"
expect_refused "delete row_signals" "append-only" "DELETE FROM row_signals WHERE entity_id = 'verify-e1'"
expect_refused "signal for a missing row" "does not exist" "INSERT INTO row_signals (entity_type, entity_id, signal, passed) VALUES ('event', 'no-such-row', 'link_live', 1)"
expect_refused "edit a transition rule" "only by migration" "UPDATE status_transition_rules SET system_allowed = 1"
expect_refused "add a transition rule" "only by migration" "INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('event', 'draft', 'approved', 1)"

echo "== rule 6 and field checks"
expect_refused "activate a source without a terms review" "CHECK constraint failed" "INSERT INTO sources (id, host, tier, active) VALUES ('verify-s1', 'example.com', 1, 1)"
expect_refused "drop-in fee without a currency" "CHECK constraint failed" "INSERT INTO venue_sessions (id, venue_id, day_of_week, start_time, timezone, style, source_url, source_tier, drop_in_fee_cents) VALUES ('verify-vs1', 'verify-v1', 1, '18:00', 'America/Chicago', 'gi', 'https://example.com/schedule', 1, 2000)"
expect_ok "session with fee and currency" "INSERT INTO venue_sessions (id, venue_id, day_of_week, start_time, timezone, style, source_url, source_tier, drop_in_fee_cents, drop_in_currency) VALUES ('verify-vs1', 'verify-v1', 1, '18:00', 'America/Chicago', 'gi', 'https://example.com/schedule', 1, 2000, 'USD')"
expect_refused "invalid calendar date" "CHECK constraint failed" "INSERT INTO events (id, event_type, name, start_date, city, state, country, source_url, source_host, source_tier, dedupe_key) VALUES ('verify-e3', 'tournament', 'X', '2027-02-30', 'X', 'MO', 'US', 'https://x.test', 'x.test', 1, 'verify-e3-key')"
expect_refused "http registration link" "CHECK constraint failed" "INSERT INTO events (id, event_type, name, start_date, city, state, country, registration_url, source_url, source_host, source_tier, dedupe_key) VALUES ('verify-e4', 'tournament', 'X', '2027-02-01', 'X', 'MO', 'US', 'http://x.test/register', 'https://x.test', 'x.test', 1, 'verify-e4-key')"
expect_refused "seminar details on a tournament" "requires a seminar event" "INSERT INTO seminar_details (event_id, instructors) VALUES ('verify-e1', '[]')"

if [ "$TARGET" = "staging" ]; then
  echo "== restoring staging to bookmark $BOOKMARK"
  "${WR[@]}" d1 time-travel restore "$DB" "${TT_FLAGS[@]}" --bookmark="$BOOKMARK" 2>&1 | grep -iE "restored|✅|error" | head -3
  expect_value "staging has no events after restore" "SELECT count(*) AS v FROM events" "0"
  expect_value "staging has no review_log rows after restore" "SELECT count(*) AS v FROM review_log" "0"
  expect_value "staging has no reviewers after restore" "SELECT count(*) AS v FROM reviewers" "0"
  expect_value "staging tables still present" "SELECT count(*) AS v FROM sqlite_master WHERE type='table' AND name IN ('events','venues','review_log','row_signals')" "4"
fi

echo "== result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
