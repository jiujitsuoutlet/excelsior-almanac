#!/usr/bin/env bash
# Run the ALMANAC console on this Mac against the REAL almanac-staging database.
#
#   bash scripts/console-staging.sh you@example.com
#
# What it does, in order:
#   1. Loads the API token from .env (never printed).
#   2. Refuses to continue unless the database's environment marker says "staging".
#   3. Adds your email to staging's reviewers table if it is not there yet.
#   4. Starts the console at http://localhost:8788 with your email as the local
#      dev identity. The dev identity works only on localhost and only for staging.
# Press Ctrl+C to stop.

set -euo pipefail
cd "$(dirname "$0")/.."

EMAIL=$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')
if ! printf '%s' "$EMAIL" | grep -Eq '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$'; then
  echo "usage: bash scripts/console-staging.sh your-email@example.com"
  exit 2
fi

set -a; source .env; set +a
DB=(almanac-staging --remote --env staging --config console/wrangler.toml)
value() { npx wrangler d1 execute "${DB[@]}" --json --command "$1" 2>/dev/null | sed -n '/^\[/,$p' | jq -r '.[0].results[0].v // "none"'; }

MARKER=$(value "SELECT name AS v FROM environment_marker WHERE id = 1")
if [ "$MARKER" != "staging" ]; then
  echo "Refusing to start: this database's environment marker is '$MARKER', not 'staging'."
  exit 1
fi
echo "Database marker: staging"

if [ "$(value "SELECT count(*) AS v FROM reviewers WHERE email = '$EMAIL'")" = "0" ]; then
  echo "Adding $EMAIL as a reviewer in STAGING"
  npx wrangler d1 execute "${DB[@]}" --command "INSERT INTO reviewers (email, role) VALUES ('$EMAIL', 'admin')" >/dev/null
fi

echo "Open http://localhost:8788 in your browser. The badge must read STAGING."
exec npx wrangler dev --config console/wrangler.toml --env staging --port 8788 \
  --var ALLOW_DEV_IDENTITY:true --var "DEV_ACCESS_EMAIL:$EMAIL"
