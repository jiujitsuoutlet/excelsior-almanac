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
wrangler(['d1', 'execute', ...d1Target, '--command', `INSERT INTO reviewers (email, role) VALUES ('${REVIEWER}', 'admin')`]);

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
  check('empty queue: "Nothing to review"', (await headline.textContent()) === 'Nothing to review', `(${await headline.textContent()})`);
  await shot(page, '01-empty-queue');

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
  await headline.filter({ hasText: '1 row, about 1 minute' }).waitFor();
  check('one row: "1 row, about 1 minute"', true);
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
  check('row still waiting after plain A', (await headline.textContent()) === '1 row, about 1 minute');
  await shot(page, '04-plain-a-refused');

  // Caps Lock: an uppercase "A" with Shift NOT held must not approve.
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', shiftKey: false, bubbles: true })));
  await page.waitForTimeout(1500);
  check('uppercase A without Shift (Caps Lock) does not approve', (await headline.textContent()) === '1 row, about 1 minute', `(${await headline.textContent()})`);

  // Shift+A approves.
  await page.keyboard.press('Shift+A');
  await headline.filter({ hasText: 'Nothing to review' }).waitFor();
  check('Shift+A approves the row', (await headline.textContent()) === 'Nothing to review');
  await shot(page, '05-approved-with-shift-a');

  // U shows recent decisions; 1 undoes.
  await page.keyboard.press('u');
  await page.getByTestId('undo-panel').waitFor();
  const undoItems = await page.locator('[data-testid="undo-panel"] li').count();
  check('U lists recent decisions', undoItems >= 1, `(${undoItems})`);
  await shot(page, '06-undo-panel');
  await page.keyboard.press('1');
  await headline.filter({ hasText: '1 row, about 1 minute' }).waitFor();
  check('undo returns the row to the queue', true);

  if (MODE === 'local') {
    // Fill the queue to twelve rows and prove the count headline.
    for (let i = 2; i <= 12; i += 1) {
      await post('/api/events', {
        event_type: 'tournament', name: `Queue Open ${i}`, start_date: `2027-0${(i % 9) + 1}-1${i % 10}`, city: `Town${i}`,
        state: 'MO', country: 'US', registration_url: `https://example.com/register/${i}`, source_url: `https://example.com/event/${i}`,
      });
    }
    await page.reload();
    await headline.filter({ hasText: '12 rows, about 4 minutes' }).waitFor();
    check('twelve rows: "12 rows, about 4 minutes"', true);
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
} finally {
  await browser?.close();
  dev.kill();
  if (MODE === 'staging' && bookmark) {
    console.log(`== restoring staging to bookmark ${bookmark}`);
    wrangler(['d1', 'time-travel', 'restore', 'almanac-staging', '--env', 'staging', '--config', CFG, `--bookmark=${bookmark}`]);
    const counts = jsonOut(wrangler(['d1', 'execute', ...d1Target, '--json', '--command',
      "SELECT (SELECT count(*) FROM events) AS events, (SELECT count(*) FROM reviewers) AS reviewers, (SELECT count(*) FROM review_log) AS logs, (SELECT name FROM environment_marker) AS marker"]))[0].results[0];
    check('staging restored: no events, reviewers or log rows; marker kept', counts.events === 0 && counts.reviewers === 0 && counts.logs === 0 && counts.marker === 'staging', JSON.stringify(counts));
  }
  if (persist) rmSync(persist, { recursive: true, force: true });
  console.log(`== result: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
