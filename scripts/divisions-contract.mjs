// Fold-in, finish brief 2026-09-23: "division rendering becomes one
// shared function both the console and the member surface call, so the
// Gi/No-Gi fix cannot drift again." The two renderers cannot share a real
// import -- separate repos, separate runtimes (this one is a Cloudflare
// static client; the member surface is a Vite SPA in excelsior-master).
// The hand-copy law (excelsior-master/docs/VERIFICATION.md) is explicit
// for exactly this case: "wherever two components must agree on a name
// or shape, one must read from the other, OR A TEST MUST COMPARE THEM
// DIRECTLY." This is that test -- it does not reimplement the rule a
// third time and compare against ITS OWN idea of the right answer; it
// calls BOTH real functions, from their own real files, on the same
// input, and fails the moment their real output disagrees.
//
// The console side has no DOM dependency in divisionsClause() itself,
// but console/public/app.js is a browser module (top-level
// window/document calls elsewhere in the file) -- it is loaded in a real
// headless browser, not Node-shimmed, so this is genuinely running the
// exact file the console deploys, not a hand-extracted copy of it.
//
// Requires excelsior-master checked out as a sibling directory (this
// machine's normal layout, confirmed by this session's own working
// directories) -- fails loudly, not silently, if it is missing.
//
// Run: node scripts/divisions-contract.mjs

import { readFileSync, existsSync } from "node:fs";
import http from "node:http";
import { chromium } from "playwright";

const MEMBER_ENGINE_PATH = new URL("../../excelsior-master/app/src/fire/dialogue/engine.js", import.meta.url);
if (!existsSync(MEMBER_ENGINE_PATH)) {
  console.error(`FATAL: excelsior-master not found as a sibling repo (expected at ${MEMBER_ENGINE_PATH.pathname}). This contract test needs both repos checked out side by side.`);
  process.exit(1);
}
const { divisionsClause: memberDivisionsClause } = await import(MEMBER_ENGINE_PATH);

const CONSOLE_APP_JS_PATH = new URL("../console/public/app.js", import.meta.url);
const consoleAppJsSource = readFileSync(CONSOLE_APP_JS_PATH, "utf8");

const HARNESS_HTML = `<!doctype html><html><body><script type="module">
  import { divisionsClause } from "/app.js";
  window.__divisionsClause = divisionsClause;
  window.__ready = true;
</script></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === "/app.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(consoleAppJsSource);
  } else {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(HARNESS_HTML);
  }
});
await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;

// Every combination of gi/nogi/kids -- the full input space either
// function's rule branches on, not a hand-picked subset.
const BOOL = [false, true];
const testRows = [];
for (const gi of BOOL) for (const nogi of BOOL) for (const kids of BOOL) {
  testRows.push({ gi, nogi, kids, name: "Contract Test Row", city: "Test City", state: "MO", start_date: "2027-01-01" });
}

// Normalizes each side's REAL return value into one comparable shape --
// parsed from their actual output text/structure, never reimplementing
// the gi/nogi/kids -> unknown decision itself (that would just be a
// third copy of the rule, grading itself).
function normalizeMember(row) {
  const line = memberDivisionsClause(row);
  if (line === "Divisions: not listed.") return { unknown: true };
  // Anchored on "(start-of-string or ". ") + label + ": " so "No-Gi: Yes"
  // can never false-match the "Gi: " extraction ("Gi: Yes" is a literal
  // substring of "No-Gi: Yes" -- a naive .includes() here would silently
  // read every no-gi-only row as gi:true too).
  const field = (label) => new RegExp(`(?:^|\\. )${label}: (Yes|No)\\.`).exec(line)?.[1] === "Yes";
  return { unknown: false, gi: field("Gi"), nogi: field("No-Gi"), kids: field("Kids") };
}
function normalizeConsole(clause) {
  if (clause === null) return { unknown: true };
  const byField = Object.fromEntries(clause.map((c) => [c.field, c.on]));
  return { unknown: false, gi: byField.gi, nogi: byField.nogi, kids: byField.kids };
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://localhost:${port}/harness.html`);
await page.waitForFunction(() => window.__ready === true);

const results = [];
for (const row of testRows) {
  const memberResult = normalizeMember(row);
  const consoleRaw = await page.evaluate((r) => window.__divisionsClause(r), row);
  const consoleResult = normalizeConsole(consoleRaw);
  const agree = JSON.stringify(memberResult) === JSON.stringify(consoleResult);
  results.push({ row: { gi: row.gi, nogi: row.nogi, kids: row.kids }, memberResult, consoleResult, agree });
  console.log(
    `${agree ? "PASS" : "FAIL"}  gi=${row.gi} nogi=${row.nogi} kids=${row.kids}  member=${JSON.stringify(memberResult)}  console=${JSON.stringify(consoleResult)}`,
  );
}

await browser.close();
server.close();

const failed = results.filter((r) => !r.agree);
console.log(`\n==== DIVISIONS CONTRACT: ${results.length - failed.length}/${results.length} agree ====`);
if (failed.length) {
  console.log("DISAGREEMENTS:", JSON.stringify(failed, null, 2));
  process.exitCode = 1;
}
