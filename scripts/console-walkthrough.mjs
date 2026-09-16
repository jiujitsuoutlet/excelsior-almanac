// Keyboard walkthrough of the ALMANAC console in a real browser (Chromium),
// at half-laptop width, with screenshots as evidence.
//
//   node scripts/console-walkthrough.mjs local     # throwaway local database
//   node scripts/console-walkthrough.mjs staging   # REAL almanac-staging; restored afterwards
//
// Staging mode records a Time Travel bookmark before writing anything, and
// restores it at the end, so staging returns to its prior state.

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { queueHeadline } from '../console/src/lib.js';

const MODE = process.argv[2];
if (!['local', 'staging'].includes(MODE)) { console.error('usage: node scripts/console-walkthrough.mjs local|staging'); process.exit(2); }

const ROOT = new URL('..', import.meta.url).pathname;
const CFG = join(ROOT, 'console/wrangler.toml');
const OUT = join(ROOT, 'evidence/console', MODE);
const REVIEWER = 'verify-reviewer@example.com';
const PORT = MODE === 'local' ? 8795 : 8794;
const BASE = `http://localhost:${PORT}`;
mkdirSync(OUT, { recursive: true });

const env = { ...process.env, CI: 'true' };
if (MODE === 'staging') {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
}
const wrangler = (args, opts = {}) => execFileSync('npx', ['wrangler', ...args], { cwd: ROOT, env, encoding: 'utf8', ...opts });
const jsonOut = (s) => JSON.parse(s.slice(s.search(/[[{]/)));

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) { pass += 1; console.log(`PASS  ${name}`); } else { fail += 1; console.log(`FAIL  ${name} ${extra}`); }
};

let persist;
let bookmark;
let d1Target;
if (MODE === 'local') {
  persist = mkdtempSync(join(tmpdir(), 'almanac-walk-'));
  d1Target = ['almanac-console-test', '--local', '--env', 'test', '--config', CFG, '--persist-to', persist];
  wrangler(['d1', 'migrations', 'apply', ...d1Target]);
  wrangler(['d1', 'execute', ...d1Target, '--command', "INSERT INTO environment_marker (id, name) VALUES (1, 'staging')"]);
} else {
  d1Target = ['almanac-staging', '--remote', '--env', 'staging', '--config', CFG];
  const marker = jsonOut(wrangler(['d1', 'execute', ...d1Target, '--json', '--command', 'SELECT name AS v FROM environment_marker WHERE id = 1']))[0].results[0]?.v;
  check('staging database carries the staging marker', marker === 'staging', `(marker: ${marker})`);
  if (marker !== 'staging') process.exit(1);
  bookmark = jsonOut(wrangler(['d1', 'time-travel', 'info', 'almanac-staging', '--env', 'staging', '--config', CFG, '--json'])).bookmark;
  console.log(`== Time Travel bookmark before test rows: ${bookmark}`);
  if (!bookmark) process.exit(1);
}
// The database may already hold rows (the founder's own hand entries on staging).
// Measured BEFORE this run writes anything, so the restore can be checked against it.
const baseline = jsonOut(wrangler(['d1', 'execute', ...d1Target, '--json', '--command',
  "SELECT (SELECT count(*) FROM events) AS events, (SELECT count(*) FROM reviewers) AS reviewers, (SELECT count(*) FROM review_log) AS logs, (SELECT count(*) FROM events WHERE status = 'needs_review') AS queue"]))[0].results[0];
wrangler(['d1', 'execute', ...d1Target, '--command', `INSERT INTO reviewers (email, role) VALUES ('${REVIEWER}', 'admin')`]);
console.log(`== baseline: ${JSON.stringify(baseline)}`);
const headlineFor = (extra) => queueHeadline(baseline.queue + extra);

const devArgs = ['wrangler', 'dev', '--config', CFG, '--port', String(PORT), '--show-interactive-dev-session=false',
  '--var', 'ALLOW_DEV_IDENTITY:true', '--var', `DEV_ACCESS_EMAIL:${REVIEWER}`];
if (MODE === 'local') devArgs.push('--env', 'test', '--local', '--persist-to', persist);
else devArgs.push('--env', 'staging');
const dev = spawn('npx', devArgs, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let devLog = '';
dev.stdout.on('data', (d) => { devLog += d; });
dev.stderr.on('data', (d) => { devLog += d; });

async function waitForServer() {
  for (let i = 0; i < 90; i += 1) {
    try { const r = await fetch(`${BASE}/api/session`); if (r.status < 500) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`console did not start:\n${devLog.slice(-2000)}`);
}

const post = (path, body) => fetch(`${BASE}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Almanac-Request': '1', Origin: BASE },
  body: JSON.stringify(body),
}).then((r) => r.json());

const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });

// Walk the queue with J until the open row is the one named.
async function gotoRowNamed(page, name, rows) {
  for (let i = 0; i < rows + 1; i += 1) {
    if ((await page.getByTestId('row').textContent()).includes(name)) return true;
    await page.keyboard.press('j');
    await page.waitForTimeout(400);
  }
  return false;
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 720, height: 860 } });
  // Keep the walkthrough off the real internet: every example.com source page is a stub.
  await context.route('https://example.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Stub source page</h1>' }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(BASE);
  const badge = page.getByTestId('env-badge');
  await badge.filter({ hasText: /STAGING|MISMATCH|NOT SIGNED IN|ERROR/ }).waitFor();
  check('badge says STAGING', (await badge.textContent()) === 'STAGING', `(badge: ${await badge.textContent()})`);
  const headline = page.getByTestId('headline');
  await headline.waitFor();
  check(`queue headline matches the ${baseline.queue} rows already waiting`, (await headline.textContent()) === headlineFor(0), `(${await headline.textContent()} vs ${headlineFor(0)})`);
  await shot(page, '01-queue-on-open');

  // N: add an event by hand.
  await page.keyboard.press('n');
  const form = page.getByTestId('add-form');
  await form.waitFor();
  await page.fill('#add-name', 'Walkthrough Open');
  await page.fill('#add-start_date', '2027-03-06');
  await page.fill('#add-venue_name', 'Springfield Expo Center');
  await page.fill('#add-city', 'Springfield');
  await page.fill('#add-state', 'MO');
  await page.fill('#add-registration_url', 'https://example.com/register/walkthrough');
  await page.check('input[name="gi"]');
  await page.fill('#add-source_url', 'https://example.com/event/walkthrough');
  await shot(page, '02-add-event-form');
  await page.keyboard.press('Enter');
  await headline.filter({ hasText: headlineFor(1) }).waitFor();
  check(`headline counts the new row: "${headlineFor(1)}"`, true);
  check('opened the row just added', await gotoRowNamed(page, 'Walkthrough Open', baseline.queue + 1));
  await page.getByTestId('gate').waitFor();
  const gate = await page.getByTestId('gate').textContent();
  check('hand entry shows "Deliberate approval required"', gate.startsWith('Deliberate approval required'), `(${gate})`);
  check('hand entry chips are grey (not checked)', (await page.locator('[data-chip="start_date"]').getAttribute('data-color')) === 'grey');
  await shot(page, '03-one-row-hand-entry');

  // O opens the source window.
  const [popup] = await Promise.all([context.waitForEvent('page'), page.keyboard.press('o')]);
  await popup.waitForLoadState();
  check('O opens the source page in the source window', popup.url() === 'https://example.com/event/walkthrough', `(${popup.url()})`);
  await page.bringToFront();

  // Plain A is refused on an unconfirmed row.
  await page.keyboard.press('a');
  await page.locator('#toast.warn').waitFor();
  check('plain A refused with a warning', (await page.locator('#toast').textContent()).includes('Shift+A'));
  check('row still waiting after plain A', (await headline.textContent()) === headlineFor(1));
  await shot(page, '04-plain-a-refused');

  // Caps Lock: an uppercase "A" with Shift NOT held must not approve.
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', shiftKey: false, bubbles: true })));
  await page.waitForTimeout(1500);
  check('uppercase A without Shift (Caps Lock) does not approve', (await headline.textContent()) === headlineFor(1), `(${await headline.textContent()})`);

  // Shift+A approves.
  await page.keyboard.press('Shift+A');
  await headline.filter({ hasText: headlineFor(0) }).waitFor();
  check('Shift+A approves the row', (await headline.textContent()) === headlineFor(0));
  await shot(page, '05-approved-with-shift-a');

  // U shows recent decisions; 1 undoes.
  await page.keyboard.press('u');
  await page.getByTestId('undo-panel').waitFor();
  const undoItems = await page.locator('[data-testid="undo-panel"] li').count();
  check('U lists recent decisions', undoItems >= 1, `(${undoItems})`);
  await shot(page, '06-undo-panel');
  await page.keyboard.press('1');
  await headline.filter({ hasText: headlineFor(1) }).waitFor();
  check('undo returns the row to the queue', true);

  // A row with no registration link: the database will never approve it, so the
  // console must say so before the reviewer presses anything (founder's case).
  await page.keyboard.press('n');
  await page.getByTestId('add-form').waitFor();
  // A unique name: staging may already hold a row with the same date and city,
  // and the console refuses same name + date + place as a duplicate.
  const noLinkName = `Fake event ${Math.random().toString(36).slice(2, 7)}`;
  await page.fill('#add-name', noLinkName);
  await page.fill('#add-start_date', '2026-10-09');
  await page.fill('#add-end_date', '2026-10-10');
  await page.fill('#add-city', 'st louis');
  await page.fill('#add-state', 'MO');
  await page.fill('#add-source_url', 'https://example.com/event/fake');
  await page.keyboard.press('Enter');
  await page.getByTestId('add-form').waitFor({ state: 'detached' });
  await headline.filter({ hasText: headlineFor(2) }).waitFor();
  check('opened the no-link row', await gotoRowNamed(page, noLinkName, baseline.queue + 2));
  const blockedGate = await page.getByTestId('gate').textContent();
  check('no-link row states the rule and the fix before any key is pressed',
    blockedGate.includes('no registration link') && blockedGate.includes('Press E'), `(${blockedGate})`);
  await shot(page, '10-no-registration-link');
  await page.keyboard.press('Shift+A');
  await page.locator('#toast.warn').waitFor();
  const blockedToast = await page.locator('#toast').textContent();
  check('Shift+A refused with the same actionable message',
    blockedToast.includes('no registration link') && blockedToast.includes('Press E'), `(${blockedToast})`);
  check('the row is still in the queue', (await headline.textContent()) === headlineFor(2));
  await page.keyboard.press('e');
  await page.locator('[data-field="registration_url"]').waitFor();
  await page.fill('[data-field="registration_url"]', 'https://example.com/register/fake');
  await page.keyboard.press('Enter');
  // Wait for the save to land: the gate line only renders when edit mode is over.
  // (A fixed delay passed locally and failed against the slower remote database.)
  await page.getByTestId('gate').waitFor();
  await page.locator('[data-field="registration_url"]').waitFor({ state: 'detached' });
  const savedGate = await page.getByTestId('gate').textContent();
  check('after adding the link the blocker is gone', !savedGate.includes('no registration link'), `(${savedGate})`);
  await page.keyboard.press('Shift+A');
  await headline.filter({ hasText: headlineFor(1) }).waitFor();
  check('Shift+A approves once the link is added with E', true);

  if (MODE === 'local') {
    // Fill the queue to twelve rows and prove the count headline.
    for (let i = baseline.queue + 2; i <= 12; i += 1) {
      await post('/api/events', {
        event_type: 'tournament', name: `Queue Open ${i}`, start_date: `2027-0${(i % 9) + 1}-1${i % 10}`, city: `Town${i}`,
        state: 'MO', country: 'US', registration_url: `https://example.com/register/${i}`, source_url: `https://example.com/event/${i}`,
      });
    }
    await page.reload();
    await headline.filter({ hasText: '12 rows, about 4 minutes' }).waitFor();
    check('twelve rows: "12 rows, about 4 minutes"', true);
    check('opened row 1 of 12', (await page.getByTestId('position').textContent()).includes('of 12'));
    await shot(page, '07-twelve-rows-headline');

    // J moves to the next row and the source window follows.
    await popup.close();
    const [followPopup] = await Promise.all([context.waitForEvent('page'), page.keyboard.press('o')]);
    await followPopup.waitForLoadState();
    const firstUrl = followPopup.url();
    await page.bringToFront();
    await page.keyboard.press('j');
    await page.getByTestId('position').filter({ hasText: 'Row 2 of 12' }).waitFor();
    for (let i = 0; i < 50 && followPopup.url() === firstUrl; i += 1) await page.waitForTimeout(200);
    const row2Source = await page.locator('.source .url').textContent();
    check('J moves to row 2 and the source window follows to its source page', followPopup.url() === row2Source && row2Source !== firstUrl, `(${firstUrl} -> ${followPopup.url()}, row 2 source ${row2Source})`);
    await page.bringToFront();

    // A hostile source page tries to navigate the console tab away. The
    // console's guard must raise the browser's leave-site dialog; dismissing
    // it must leave the console where it was.
    await context.route('https://evil.example/**', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Fake console</h1>' }));
    const dialogs = [];
    page.on('dialog', async (d) => { dialogs.push(d.type()); await d.dismiss(); });
    await followPopup.evaluate(() => { window.opener.location.href = 'https://evil.example/fake-console'; });
    await page.waitForTimeout(2000);
    check('hostile source page cannot silently move the console: leave-site dialog raised', dialogs.includes('beforeunload'), `(dialogs: ${dialogs.join(',') || 'none'})`);
    check('console is still on the console after the dialog is dismissed', page.url().startsWith(BASE), `(${page.url()})`);

    // R then 2 rejects with a reason.
    await page.keyboard.press('r');
    await page.getByTestId('reject-panel').waitFor();
    await shot(page, '08-reject-reasons');
    await page.keyboard.press('2');
    await headline.filter({ hasText: '11 rows, about 4 minutes' }).waitFor();
    check('R then 2 rejects the row', true);

    // Make five more decisions, then U shows exactly five.
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('Shift+A');
      await headline.filter({ hasText: `${10 - i} rows` }).waitFor();
    }
    await page.keyboard.press('u');
    await page.getByTestId('undo-panel').waitFor();
    check('U shows the last five decisions', (await page.locator('[data-testid="undo-panel"] li').count()) === 5);
    await shot(page, '09-undo-last-five');
    await page.keyboard.press('Escape');
  }

  check('no browser console errors', errors.length === 0, errors.join(' | '));
} catch (err) {
  fail += 1;
  console.log(`FAIL  walkthrough crashed: ${err.message}`);
  console.log(String(err.stack).split('\n').slice(0, 6).join('\n'));
} finally {
  await browser?.close();
  dev.kill();
  if (MODE === 'staging' && bookmark) {
    console.log(`== restoring staging to bookmark ${bookmark}`);
    wrangler(['d1', 'time-travel', 'restore', 'almanac-staging', '--env', 'staging', '--config', CFG, `--bookmark=${bookmark}`]);
    const counts = jsonOut(wrangler(['d1', 'execute', ...d1Target, '--json', '--command',
      "SELECT (SELECT count(*) FROM events) AS events, (SELECT count(*) FROM reviewers) AS reviewers, (SELECT count(*) FROM review_log) AS logs, (SELECT name FROM environment_marker) AS marker"]))[0].results[0];
    const same = counts.events === baseline.events && counts.reviewers === baseline.reviewers && counts.logs === baseline.logs;
    check('staging restored to the rows it held before this run; marker kept',
      same && counts.marker === 'staging', `(after ${JSON.stringify(counts)} vs baseline ${JSON.stringify(baseline)})`);
  }
  if (persist) rmSync(persist, { recursive: true, force: true });
  console.log(`== result: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
