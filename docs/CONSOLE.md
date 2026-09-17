# The ALMANAC approval console

The console is where a reviewer clears the queue: one row at a time, the
source page beside the facts, keyboard first. It runs as a Cloudflare Worker
(`console/`) against the D1 database. It is not deployed yet.

## Founder rulings built in (2026-09-15)

- **Shift+A on anything unconfirmed.** A plain `A` approves only when name,
  date, location and registration link are all green (found on the source page)
  and no possible duplicate is open. Anything amber or grey needs `Shift+A`.
  Your own hand entries have no checks yet, so they always need `Shift+A`.
  The server enforces this; the key is not only a front-end rule.
- **The count before you start.** The headline reads, for example,
  "12 rows, about 4 minutes" (20 seconds a row).
- **Undo reaches five.** `U` lists your last five approvals and rejections;
  press 1 to 5 to send one back to the queue.
- **Hand entries go through the queue**, never straight to approved.
- **Access session: 7 days** (set on the Access application at deploy).

## What you see

- Top bar: ALMANAC, the environment badge, and who you are signed in as. The
  badge is read from the database's own `environment_marker` row, not from a
  setting. If the marker is missing or disagrees with the console, the badge
  reads ENVIRONMENT MISMATCH and every write is refused.
- Status strip: needs review, approved and upcoming, stale, rejected this week,
  last scout run, and whether publishing is connected.
- Empty queue: "Nothing to review" and an **Add event (N)** button.
- One row: position and source host, the source link, each fact with its chip
  (green "found on page", amber "not confirmed", grey "not checked"), the
  duplicate line, and the approval gate line saying whether `A` works or
  `Shift+A` is required, and why.

Change from the proposal: most event sites refuse to be shown inside another
page, and the console lives in half a laptop screen, so the source page always
opens in the separate source window (`O`) and the console shows the source link
as a bar instead of an embedded pane.

## Keys

| Key | Does |
|---|---|
| `A` | Approve (only when every critical field is green and no duplicate is open) |
| `Shift+A` | Deliberate approve, for rows with anything unconfirmed |
| `R` then `1`-`6` | Reject: not a real event, wrong date, wrong place, bad link, duplicate, out of scope |
| `E` | Edit the row (Enter saves, Esc cancels) |
| `M` / `D` | Merge into the possible duplicate / mark it distinct |
| `O` | Open the source page in the source window; it follows you row to row |
| `F` | Copy the first unconfirmed value, then Cmd+F, Cmd+V in the source window |
| `J` / `K` / `S` | Next / previous / skip to the end |
| `U` | Undo one of your last five decisions |
| `N` | Add an event by hand |
| `?` | Help |

Caps Lock never turns `A` into a deliberate approval; only a held Shift does.

## Security notes

- **Deployed 2026-09-17** at `https://almanac-console.paul-tokgozoglu.workers.dev`,
  behind Cloudflare Access: identity provider GitHub (tested, "Your connection
  works!"), application "ALMANAC Console", policy "Reviewers" (Allow, exactly
  the three emails in the `reviewers` table), accept-all-identity-providers
  off, session 7 days. Confirmed live: an unauthenticated request and a
  request carrying a forged `Cf-Access-Jwt-Assertion` header both get a `302`
  from Cloudflare's own edge before reaching the Worker at all. The Worker
  also independently verifies the Access token's signature, issuer, audience
  and expiry on every request as a second layer.
- **Two-factor on the reviewer GitHub accounts is unverified, not confirmed.**
  This was supposed to be checked before this deploy (per the rule below and
  ARCHITECTURE.md Section 4), but neither the founder nor the agent could
  actually verify it: the agent's GitHub token lacks `admin:org` (confirmed
  by a live `404`, not assumed), and the founder was unable to check it
  directly either. GitHub login itself is enforced and working. Whether
  2FA is actually on for `paul.tokgozoglu@gmail.com`, `paul@jiujitsuoutlet.com`,
  and `jujitsuoutlet@gmail.com`'s GitHub accounts is an open item, not a
  closed one. Check `https://github.com/orgs/jiujitsuoutlet/people` directly,
  or grant `admin:org` to the CLI session and re-check, before treating this
  rule as satisfied.
- Every reviewer's GitHub account is required to have two-factor authentication
  turned on. The one-time email PIN login method stays off.
- Locally, a dev identity stands in for Access. It works only when the console
  runs as staging, only on `localhost`, and only when started with
  `ALLOW_DEV_IDENTITY`. Production ignores it whatever its settings say.
- Writes need the same origin and an `X-Almanac-Request` header (cross-site
  protection). All text is rendered as text, never as markup, under a strict
  Content-Security-Policy.
- The source window keeps its link back to the console so it can follow you
  row to row. While it is open, any attempt to move the console tab away (for
  example by a hostile source page) raises the browser's "Leave site?" dialog.
  Reloading the console while the source window is open shows the same dialog;
  that is expected.

## Run it locally against staging

Prerequisite, already satisfied: the account has the workers.dev subdomain
`paul-tokgozoglu.workers.dev` (dashboard: Compute > Workers & Pages, right-hand
Account details). Wrangler needs it to reach a remote database from your Mac.

```bash
cd ~/jjo/excelsior-almanac
```

```bash
bash scripts/console-staging.sh your-github-email@example.com
```

If it stops with **"Address already in use"**, a console from an earlier
Terminal window is still running on that port. Stop it with Ctrl+C in that
window, or from any window:

```bash
lsof -ti:8788 | xargs kill -9
```

Then start it again. (The same applies to port 8788 only; the batteries use
their own ports.)

Open http://localhost:8788. The badge must read **STAGING**. Anything you add
there is written to the staging database. To wipe it afterwards, restore
staging to a bookmark taken before you started:

```bash
npx wrangler d1 time-travel info almanac-staging --env staging
```

```bash
npx wrangler d1 time-travel restore almanac-staging --env staging --bookmark=PASTE_BOOKMARK
```

## Evidence batteries

Every battery below is reported with its gap list: see `docs/VERIFICATION.md`,
which states what each one does NOT cover. A passing count alone is not a
report.

```bash
npm run test:unit
```
Unit tests: the Shift+A gate, chips, count headline, duplicates, input
validation, Access token checks with a real RSA key, and the dev identity guard.

```bash
npm run verify:console
```
API battery against throwaway local databases: every rule above, including the
refusals (plain A on unconfirmed rows, cross-site writes, non-reviewers,
production refusing the dev identity and a forged token, a database with no
marker refusing writes).

```bash
node scripts/console-walkthrough.mjs local
```
Real-browser keyboard walkthrough at half-laptop width with screenshots in
`evidence/console/local/`, including the hostile source page test.

```bash
node scripts/console-walkthrough.mjs staging
```
The same walkthrough against the real `almanac-staging`, with a Time Travel
bookmark before and a restore after. Needs the workers.dev subdomain.
