// Page grounding (founder ruling, 2026-09-19): "A challenge, timeout,
// HTTP 200 login page, or unrelated redirect is not proof of a working
// registration page" (originally about registration-link checks,
// applied here to every fetched page this crawl trusts). A response can
// carry a real HTTP 200 and still not be the content it claims to be --
// a Cloudflare interstitial, a login wall, a soft-404 -- and trusting it
// anyway is exactly how a false fact enters the pipeline.
//
// Pure: takes the shape fetcher.js's fetchOnce() already returns
// (status, body, redirectTo, notModified), decides nothing about
// network or timing. Deliberately conservative -- a page this function
// calls ungrounded is simply not used; nothing here tries to "fix" a
// bad page, only to refuse trusting one.

// Real interstitial/challenge/login-wall signatures, checked against the
// actual page text. Kept short and specific on purpose: a broad pattern
// (e.g. matching the bare word "login") would false-positive on a
// legitimate event page that happens to mention needing to log in to
// register, which is a fact about the page, not a sign the page itself
// is a wall.
const CHALLENGE_SIGNATURES = [
  { pattern: /checking your browser before accessing/i, reason: 'Cloudflare "checking your browser" interstitial' },
  { pattern: /cf-browser-verification/i, reason: 'Cloudflare browser-verification challenge' },
  { pattern: /enable javascript and cookies to continue/i, reason: 'JS/cookie interstitial wall' },
  { pattern: /\bg-recaptcha\b|\bh-captcha\b/i, reason: 'a CAPTCHA challenge is present on the page' },
];

// Checked as co-occurrence, not one regex: either phrase alone is
// ordinary English a real event page could legitimately contain ("just a
// moment while we load your tickets"; "hosted on Cloudflare"). Both
// together, anywhere in the same document, is specifically Cloudflare's
// own interstitial copy.
function isCloudflareWaitingRoom(body) {
  return /\bjust a moment\b/i.test(body) && /cloudflare/i.test(body);
}

// A real page has real markup; an interstitial or a bare error stub is
// typically far shorter than any genuine listing or event detail page.
// This floor is deliberately low (a real generous margin below the
// smallest real page this parser has ever seen in its own fixtures) so
// it only ever catches a genuinely empty or near-empty response, never a
// real but short page.
const MIN_REAL_PAGE_BYTES = 400;

/**
 * @param {{status: number, body: string|null, redirectTo: string|null, notModified: boolean}} response
 * @returns {{grounded: true} | {grounded: false, reason: string}}
 */
export function groundPage(response) {
  const r = response ?? {};
  if (r.redirectTo) {
    return { grounded: false, reason: `redirected to ${r.redirectTo}; the crawler never follows a redirect, the destination is a path nobody reviewed` };
  }
  if (r.notModified) {
    return { grounded: false, reason: 'server returned 304 Not Modified; there is no new content to ground' };
  }
  if (typeof r.status !== 'number' || r.status < 200 || r.status >= 300) {
    return { grounded: false, reason: `http ${r.status ?? 'unknown'}, not a successful response` };
  }
  const body = typeof r.body === 'string' ? r.body : '';
  if (body.length < MIN_REAL_PAGE_BYTES) {
    return { grounded: false, reason: `response body is only ${body.length} bytes, too short to be a real page` };
  }
  for (const { pattern, reason } of CHALLENGE_SIGNATURES) {
    if (pattern.test(body)) {
      return { grounded: false, reason: `looks like ${reason}, not the site's real content` };
    }
  }
  if (isCloudflareWaitingRoom(body)) {
    return { grounded: false, reason: 'looks like Cloudflare\'s "Just a moment..." interstitial, not the site\'s real content' };
  }
  return { grounded: true };
}
