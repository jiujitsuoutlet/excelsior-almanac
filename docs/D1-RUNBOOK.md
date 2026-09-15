# D1 runbook: apply and verify the ALMANAC schema

This runbook is for the founder. It assumes no D1 experience. Run every command
from the repository folder in Terminal. Each step says what you should see.

## What D1 is, in two lines

D1 is Cloudflare's SQL database (SQLite underneath). `wrangler` is Cloudflare's
command-line tool. It sends your commands to D1 using the API token in `.env`.

## The two databases

| Name | Purpose | Flag to use |
|---|---|---|
| `almanac` | Production. Real rows only. Never run the test battery here. | `--remote` |
| `almanac-staging` | Staging. The test battery runs here and restores itself. | `--remote --env staging` |

Without `--remote`, wrangler uses a throwaway local copy on your Mac, not Cloudflare.

## Step 0: once per Terminal window

```bash
cd ~/jjo/excelsior-almanac
```

```bash
npm ci
```
You see npm install the pinned wrangler version. Nothing is written to Cloudflare.

```bash
set -a; source .env; set +a
```
This loads the API token into this Terminal window without showing it. Do not
run `echo` on it or paste it anywhere.

## Step 1: confirm who you are

```bash
npx wrangler whoami
```
You see one account: `Paul.tokgozoglu@gmail.com's Account`, ID
`bbe6d5f6cc43632eafdd5ef854f48a25`. If you see any other account, stop.

```bash
npx wrangler d1 list
```
You see two databases: `almanac` and `almanac-staging`.

## Step 2: see what production is waiting for

```bash
npx wrangler d1 migrations list almanac --remote
```
Before you apply, you see one migration to apply:
`20260915000100_core_schema.sql`.

## Step 3: take a restore point, then apply to production

```bash
npx wrangler d1 time-travel info almanac
```
You see "The current bookmark is '...'". Copy that bookmark into your notes. It
is the restore point from before the schema existed.

```bash
npx wrangler d1 migrations apply almanac --remote
```
Wrangler asks you to confirm. Type `y`. You see a table with the migration name
and a green check.

```bash
npx wrangler d1 migrations list almanac --remote
```
You now see "No migrations to apply!"

## Step 4: verify every table exists

```bash
npx wrangler d1 execute almanac --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```
You see exactly these 18 names:

- The 15 ALMANAC tables: `approval_rules`, `camp_details`,
  `competition_details`, `coverage_requests`, `crawl_runs`, `events`,
  `review_log`, `reviewers`, `row_signals`, `seminar_details`, `sources`,
  `status_transition_rules`, `superfight_details`, `venue_sessions`, `venues`.
- Three that the tools create themselves: `_cf_KV` (Cloudflare internal),
  `d1_migrations` (wrangler's record of applied migrations), `sqlite_sequence`
  (SQLite's counter for the append-only logs).

To see one table's columns, for example `events`:

```bash
npx wrangler d1 execute almanac --remote --command "PRAGMA table_info(events)"
```
You see one row per column: name, type, whether it is required, and its default.

## Step 5: verify the rules are installed

```bash
npx wrangler d1 execute almanac --remote --command "SELECT (SELECT count(*) FROM sqlite_master WHERE type='trigger') AS triggers, (SELECT count(*) FROM status_transition_rules) AS transition_rules, (SELECT count(*) FROM approval_rules WHERE enabled = 1) AS enabled_auto_rules, (SELECT count(*) FROM events) AS events"
```
You see `triggers` 36, `transition_rules` 34, `enabled_auto_rules` 0, `events` 0.

## Step 6: prove three rules on production without writing anything

Each command below must FAIL. The error is the proof. Nothing is written,
because the database refuses the statement.

A new row cannot start out approved:

```bash
npx wrangler d1 execute almanac --remote --command "INSERT INTO events (id, event_type, name, start_date, city, state, country, source_url, source_host, source_tier, dedupe_key, status, approved_at) VALUES ('proof-1', 'tournament', 'Proof', '2027-01-01', 'Springfield', 'MO', 'US', 'https://example.com', 'example.com', 1, 'proof-1', 'approved', '2026-09-15')"
```
Expected error contains: `new rows start as draft with no approval`.

An automatic approval rule cannot be switched on without an amendment:

```bash
npx wrangler d1 execute almanac --remote --command "INSERT INTO approval_rules (id, tier, enabled) VALUES ('proof_rule', 1, 1)"
```
Expected error contains: `CHECK constraint failed`.

The list of allowed status transitions cannot be changed outside a migration:

```bash
npx wrangler d1 execute almanac --remote --command "INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('event', 'draft', 'approved', 1)"
```
Expected error contains: `status_transition_rules change only by migration`.

Then confirm nothing was written:

```bash
npx wrangler d1 execute almanac --remote --command "SELECT count(*) AS events, (SELECT count(*) FROM approval_rules) AS rules FROM events"
```
You see `events` 0 and `rules` 0.

## Step 7 (optional): run the full battery on staging

```bash
npm run verify:schema:staging
```
This takes about a minute. It writes test rows to `almanac-staging`, tries to
break every rule, then restores staging to the bookmark it took first. The last
line must read `58 passed, 0 failed`.

## Step 8: the environment marker (after the console pull request merges)

The console reads a marker row inside each database to prove which environment
it is connected to. Apply the second migration, then write the marker once.

```bash
npx wrangler d1 migrations apply almanac --remote
```
You see `20260915000200_environment_marker.sql` with a green check.

```bash
npx wrangler d1 execute almanac --remote --command "INSERT INTO environment_marker (id, name) VALUES (1, 'production')"
```

```bash
npx wrangler d1 execute almanac --remote --command "SELECT name FROM environment_marker"
```
You see `production`. Now prove it can never change. This command must FAIL:

```bash
npx wrangler d1 execute almanac --remote --command "UPDATE environment_marker SET name = 'staging'"
```
Expected error contains: `environment_marker never changes`.

After this step, Step 4 lists 19 tables (adding `environment_marker`) and Step 5
counts 39 triggers.

## How status changes (for the console and for you)

A status never changes by `UPDATE`. It changes when one row is added to
`review_log` with `action = 'transition'`, naming the row, its current status,
the new status and the actor. The database checks the move against
`status_transition_rules` and applies it. A direct `UPDATE ... SET status`
fails for everyone, the console included.

A human actor must be an active row in `reviewers`. System actors are named
`system:<component>` and can only make the moves marked `system_allowed = 1`.
No system actor can approve while every automatic approval rule is off.

## What the database cannot stop

Anyone holding a token with D1 Edit can run schema commands, such as dropping
a trigger. Schema changes therefore go only through a new migration file in a
pull request. Step 5 above shows whether all 36 triggers are still present.

## If something goes wrong

Restore production to the bookmark you copied in Step 3:

```bash
npx wrangler d1 time-travel restore almanac --bookmark=PASTE_BOOKMARK_HERE
```
D1 keeps 30 days of history on the Workers Paid plan.
