// One-off, hand-run research script (founder-authorized extension of the
// standing terms-review authority, 2026-09-20): for each candidate
// organizer subdomain, fetch its own robots.txt and its own terms page
// (the parent's terms PATH, /en/agreements, tried on the subdomain
// itself), and report exactly what the rule needs to decide:
//   - robots.txt hash match against the parent's recorded hash
//   - terms page: 404, or byte-identical to the parent's, or different
// Writes nothing. Prints JSON, one line per host, for a human (or the
// next step of this same session) to act on.

import { USER_AGENT } from '../scout/src/identity.js';

const PARENT_HOST = 'smoothcomp.com';
const TERMS_PATH = '/en/agreements';

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text ?? ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function get(url) {
  const res = await fetch(url, { method: 'GET', headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' }, redirect: 'manual' });
  const body = res.status >= 200 && res.status < 300 ? await res.text() : '';
  return { status: res.status, body, bytes: body.length };
}

const hosts = process.argv.slice(2);

const parentRobots = await get(`https://${PARENT_HOST}/robots.txt`);
const parentRobotsHash = await sha256Hex(parentRobots.body);
const parentTerms = await get(`https://${PARENT_HOST}${TERMS_PATH}`);
const parentTermsHash = await sha256Hex(parentTerms.body);

console.log(JSON.stringify({ parent: { host: PARENT_HOST, robotsStatus: parentRobots.status, robotsBytes: parentRobots.bytes, robotsSha256: parentRobotsHash, termsStatus: parentTerms.status, termsBytes: parentTerms.bytes, termsSha256: parentTermsHash } }, null, 2));

for (const host of hosts) {
  const robots = await get(`https://${host}/robots.txt`);
  const robotsHash = await sha256Hex(robots.body);
  const terms = await get(`https://${host}${TERMS_PATH}`);
  const termsHash = terms.status === 200 ? await sha256Hex(terms.body) : null;

  const robotsSame = robots.status === parentRobots.status && robotsHash === parentRobotsHash;
  const termsInherits = terms.status === 404 || (terms.status === 200 && termsHash === parentTermsHash);

  console.log(JSON.stringify({
    host,
    robots: { status: robots.status, bytes: robots.bytes, sha256: robotsHash, matchesParent: robotsSame },
    terms: { status: terms.status, bytes: terms.bytes, sha256: termsHash, sameAsParentOr404: termsInherits },
    verdict: robotsSame && termsInherits ? 'inherited_parent' : 'not_allowed',
  }, null, 2));
}
