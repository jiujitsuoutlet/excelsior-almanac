#!/usr/bin/env bash
# Fetch ONE Smoothcomp event page, by hand, on your word.
#
#   bash scripts/fetch-one.sh https://smoothcomp.com/en/event/<id>/<name>
#
# What happens, in order:
#   1. Reads the smoothcomp.com terms review row out of the STAGING database.
#   2. Runs the same gate the scout runs. No review, no fetch.
#   3. Checks your URL is a public event detail page, not a bracket, a
#      registration list, an athlete profile or a checkout page.
#   4. Prints exactly what it will request and what Smoothcomp's access log
#      will show, then stops and asks you to type yes.
#   5. Fetches robots.txt, checks it has not changed since the review, waits
#      the crawl delay, then fetches your one page.
#   6. Prints what the parser made of it.
#
# It writes NOTHING to the events table, in any database. It records one row
# in crawl_runs in STAGING so there is always an honest answer to "when did
# we touch Smoothcomp".
#
# There is no schedule anywhere. This runs when you run it, and not otherwise.

set -euo pipefail
cd "$(dirname "$0")/.."

URL="${1:-}"
if [ -z "$URL" ]; then
  echo "usage: bash scripts/fetch-one.sh https://smoothcomp.com/en/event/<id>/<name>"
  exit 2
fi

if [ ! -t 0 ]; then
  echo "Refusing to run without a terminal: this command asks for your word before it fetches."
  exit 2
fi

if [ ! -f .env ]; then
  echo "Refusing to run: .env is missing (it holds the Cloudflare token)."
  exit 2
fi
set -a; source .env; set +a

DB=(almanac-staging --remote --env staging --config console/wrangler.toml)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "Reading the smoothcomp.com terms review from STAGING..."
npx wrangler d1 execute "${DB[@]}" --json \
  --command "SELECT * FROM sources WHERE host = 'smoothcomp.com'" 2>/dev/null \
  | sed -n '/^\[/,$p' | jq '.[0].results[0] // empty' > "$TMP/source.json"

if [ ! -s "$TMP/source.json" ]; then
  echo "STOP: there is no smoothcomp.com row in the staging sources table."
  echo "Nothing is fetched before its terms review is recorded."
  exit 3
fi

MARKER=$(npx wrangler d1 execute "${DB[@]}" --json --command "SELECT name AS v FROM environment_marker WHERE id = 1" 2>/dev/null | sed -n '/^\[/,$p' | jq -r '.[0].results[0].v // "none"')
if [ "$MARKER" != "staging" ]; then
  echo "STOP: this database says it is '$MARKER', not staging."
  exit 3
fi

echo ""
echo "================ WHAT THIS WILL DO ================"
node scripts/fetch-one.mjs --source "$TMP/source.json" --url "$URL" --plan
echo "==================================================="
echo ""
printf 'Type yes to make these two requests: '
read -r ANSWER
if [ "$ANSWER" != "yes" ]; then
  echo "Nothing was fetched."
  exit 0
fi
echo ""

RUN_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
npx wrangler d1 execute "${DB[@]}" \
  --command "INSERT INTO crawl_runs (id, component, status) VALUES ('$RUN_ID', 'tier1_scout', 'running')" >/dev/null 2>&1
echo "crawl_runs row $RUN_ID opened in staging."
echo ""

set +e
node scripts/fetch-one.mjs --source "$TMP/source.json" --url "$URL" --go
CODE=$?
set -e

if [ "$CODE" -eq 0 ]; then STATUS=succeeded; PAGES=2; ERRS=0; else STATUS=failed; PAGES=1; ERRS=1; fi
npx wrangler d1 execute "${DB[@]}" \
  --command "UPDATE crawl_runs SET status = '$STATUS', finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), pages_fetched = $PAGES, errors = $ERRS WHERE id = '$RUN_ID'" >/dev/null 2>&1

echo ""
echo "crawl_runs row $RUN_ID closed as $STATUS."
exit "$CODE"
