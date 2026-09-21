#!/usr/bin/env bash
# ALMANAC production cutover for the Scout listing crawl (founder ruling,
# 2026-09-20, step 2: "If it is clean, deploy Scout against PRODUCTION
# ALMANAC D1. Nothing reaches a member without my Shift+A, so production
# crawl is safe behind the existing gate").
#
# This writes to PRODUCTION. It is deliberately one reviewed script rather
# than a handful of typed commands, so what production receives is a thing
# that can be read before it runs, and re-read afterwards.
#
# What it does NOT do, on purpose:
#   - approve anything. Every row it can produce lands `needs_review`; the
#     database refuses a system actor the approve transition outright.
#   - touch the app (excelsior-master). No Supabase migration, no --prod
#     promotion. Those are the founder's own gate.
#   - fetch an event page. Production runs the same listing_only mode that
#     staging proved.
#
#   bash scripts/production-cutover.sh --dry-run    # print, change nothing
#   bash scripts/production-cutover.sh --go

set -uo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "no .env; wrangler needs CLOUDFLARE_API_TOKEN"; exit 2; }
set -a; . ./.env; set +a

MODE="${1:---dry-run}"
DB=almanac
CFG=scout/wrangler.toml
WR=(npx wrangler)
ROBOTS_SHA="312e3e13bb11b8d626a95305dce10dc6115d866d07215ad30ecd6c805e362701"
REVIEWER="paul.tokgozoglu@gmail.com"
TODAY=$(date -u +%Y-%m-%d)

say() { echo -e "\n== $1"; }
run() {
  if [ "$MODE" = "--go" ]; then eval "$@"; else echo "   [dry-run] $*"; fi
}
d1() { "${WR[@]}" d1 execute "$DB" --remote --config "$CFG" --json --command "$1" 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['results'])" 2>/dev/null; }

say "0. Pre-flight: what production looks like right now"
echo "   pending migrations:"
"${WR[@]}" d1 migrations list "$DB" --remote --config "$CFG" 2>&1 | grep -E "^│ [0-9]|No migrations" | sed 's/^/     /'
echo "   marker:   $(d1 'SELECT name FROM environment_marker')"
echo "   sources:  $(d1 'SELECT id, active, crawl_mode FROM sources' 2>/dev/null || echo '(crawl_mode column not migrated yet)')"
echo "   events:   $(d1 'SELECT count(*) n FROM events')"
echo "   aliases:  $(d1 'SELECT count(*) n FROM source_aliases' 2>/dev/null || echo '(table not migrated yet)')"

say "1. Apply pending migrations (additive; adds source_aliases, discovered_pages, places, provenance columns)"
if [ "$MODE" = "--go" ]; then
  "${WR[@]}" d1 migrations apply "$DB" --remote --config "$CFG" 2>&1 | tail -12
else
  echo "   [dry-run] wrangler d1 migrations apply $DB --remote"
fi

say "2. Load the gazetteer (same cities500 file and geoname_id keys as the app's own import)"
run "node scripts/import-places-d1.mjs --target=production"

say "3. Activate the six reviewed organizer aliases"
ALIASES="alias-fujibjj|fujibjj.smoothcomp.com|/en/federation/201/events/upcoming
alias-agf|agf.smoothcomp.com|/en/federation/279/events/upcoming
alias-newbreedbjj|newbreedbjj.smoothcomp.com|/en/federation/65/events/upcoming
alias-naga|naga.smoothcomp.com|/en/federation/32/events/upcoming
alias-grapplingindustries|grapplingindustries.smoothcomp.com|/en/federation/23/events/upcoming
alias-submissionchallenge|submissionchallenge.smoothcomp.com|/en/federation/45/events/upcoming"
REASON="robots.txt (sha256 ${ROBOTS_SHA}) is byte-identical to the parent smoothcomp.com robots.txt (measured live 2026-09-20). /en/agreements on this subdomain returns 404 -- no subdomain-specific terms document exists; smoothcomp.com/en/agreements is the only Terms of Service. Per the founder''s 2026-09-20 ruling, a 404 or byte-identical subdomain terms page inherits the parent''s allowed_with_conditions verdict."
SQL=""
while IFS='|' read -r id host path; do
  SQL+="INSERT OR IGNORE INTO source_aliases (id, source_id, host, listing_path, added_by, added_on, robots_sha256, robots_read_on, organizer_terms_url, organizer_terms_checked_on, active, terms_verdict, terms_reasoning) VALUES ('$id','src-smoothcomp','$host','$path','$REVIEWER','$TODAY','$ROBOTS_SHA','$TODAY',NULL,'$TODAY',1,'inherited_parent','$REASON'); "
done <<< "$ALIASES"
SQL+="UPDATE sources SET crawl_mode='listing_only', active=1 WHERE id='src-smoothcomp';"
if [ "$MODE" = "--go" ]; then
  printf '%s' "$SQL" > /tmp/prod-aliases.sql
  "${WR[@]}" d1 execute "$DB" --remote --config "$CFG" --file /tmp/prod-aliases.sql 2>&1 | grep -E "Executed|ERROR" | sed 's/^/   /'
  rm -f /tmp/prod-aliases.sql
else
  echo "   [dry-run] 6 alias inserts + crawl_mode='listing_only'"
fi

say "4. Deploy the Scout Worker to production (nightly cron; SCOUT_ENABLED must be true in [vars])"
# Refuse to deploy an inert Worker while reporting success. Production's own
# [vars]/[triggers] are the gate that has been held all program; flipping
# them is a deliberate edit to scout/wrangler.toml, not something this
# script does behind your back -- but deploying BEFORE that edit would
# quietly ship a Worker that never runs and looks deployed.
PROD_SECTION=$(awk '/^\[env\./{exit} {print}' scout/wrangler.toml)
if ! echo "$PROD_SECTION" | grep -q 'SCOUT_ENABLED = "true"'; then
  echo "   REFUSING: production [vars] still has SCOUT_ENABLED = \"false\"."
  echo "   Deploying now would ship a Worker that never runs. Edit scout/wrangler.toml's"
  echo "   production section (SCOUT_ENABLED = \"true\" and a [triggers] crons entry) first."
  exit 3
fi
if ! echo "$PROD_SECTION" | grep -q '^\[triggers\]'; then
  echo "   REFUSING: production config has no [triggers] section, so nothing would schedule it."
  exit 3
fi
run "(cd scout && ${WR[*]} deploy)"

say "5. Deploy the console to production (precision metric, footprint-first queue, provenance banner)"
run "(cd console && ${WR[*]} deploy)"

say "6. Post-flight"
echo "   sources:  $(d1 'SELECT id, active, crawl_mode FROM sources')"
echo "   aliases:  $(d1 'SELECT count(*) n, sum(active) active FROM source_aliases')"
echo "   places:   $(d1 'SELECT count(*) n FROM places')"
echo "   events:   $(d1 'SELECT status, count(*) n FROM events GROUP BY status')"
echo
echo "Nothing above approves anything. Every crawled row lands needs_review,"
echo "and needs_review -> approved is system_allowed = 0: only a reviewer approves."
