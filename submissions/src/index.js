// ALMANAC Tier 3 public submission Worker. No Cloudflare Access (unlike
// the console) -- an organizer with no jiujitsuoutlet.com identity must
// reach this. Same insert path as console's own hand-entry (addEvent),
// same events table, same needs_review queue, no new approval path --
// only the gate in front of it differs (Turnstile + rate limit +
// honeypot instead of a reviewer login).
//
// scout/src/parsers/smoothcomp.js already imports console/src/lib.js
// cross-directory; that's this repo's own established pattern for
// sharing pure logic between Workers without a package boundary, not a
// new one invented here.
import { addEvent, getMarker, ConsoleError } from '../../console/src/data.js';
import { validateEventInput, isHttpUrl } from '../../console/src/lib.js';
import { geocode } from '../../console/src/geocode.js';
import { verifyTurnstile } from './turnstile.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// Real browsers never see or fill this (hidden via CSS in public/index.html,
// labeled plausibly for a bot -- see the form's own comment). A filled
// honeypot gets a FAKE success: the request is dropped, nothing is
// written, but the caller sees 201 same as a real submission, so a bot
// tuning against response codes learns nothing that helps it adapt.
const HONEYPOT_FIELD = 'organizer_website_url';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/submit') {
      try {
        return await handleSubmit(request, env);
      } catch (err) {
        if (err instanceof ConsoleError) return json(err.status, { error: err.message, ...(err.details ? { details: err.details } : {}) });
        console.error('submissions error', err);
        return json(500, { error: 'Internal error' });
      }
    }
    if (request.method === 'GET' && url.pathname === '/' && env.ASSETS) {
      // The Turnstile SITE key (public by design, unlike the secret key)
      // is a Worker var, not baked into the static file at build time --
      // one asset file, injected per-environment, rather than a
      // staging/production copy of the same HTML differing only in this.
      const res = await env.ASSETS.fetch(request);
      const html = await res.text();
      return new Response(html.replace('__TURNSTILE_SITE_KEY__', env.TURNSTILE_SITE_KEY ?? ''), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  },
};

async function handleSubmit(request, env) {
  // Same-origin + a plain custom header is the console's own CSRF guard
  // (see console/src/index.js's own comment); this Worker is meant to
  // be reachable from anywhere BY DESIGN, so that guard does not apply
  // here -- Turnstile and the rate limiter are the real gate instead.
  // The environment-marker guard DOES still apply, unchanged from the
  // console's own copy: this whole session's own history is exactly why
  // (a wrong deploy target writing real rows to the wrong database, see
  // the sibling excelsior-master repo's build log) -- a public write
  // path deserves this check at least as much as an authenticated one.
  const marker = await getMarker(env.DB).catch(() => null);
  if (marker === null || marker !== env.ENVIRONMENT) {
    console.error('submissions: environment mismatch', { configured: env.ENVIRONMENT, database: marker });
    return json(500, { error: 'Temporarily unavailable. Please try again shortly.' });
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const { success: withinLimit } = await env.SUBMIT_RATE_LIMITER.limit({ key: ip });
  if (!withinLimit) return json(429, { error: 'Too many submissions from this address. Try again in a minute.' });

  let body;
  try {
    body = await request.json();
  } catch {
    throw new ConsoleError(400, 'Request body must be JSON');
  }

  if (String(body[HONEYPOT_FIELD] ?? '').trim() !== '') {
    // Looks like a real submission to the caller; is not one.
    return json(201, { status: 'received' });
  }

  const turnstileResult = await verifyTurnstile(body.turnstileToken, env.TURNSTILE_SECRET_KEY, ip);
  if (!turnstileResult.ok) {
    // 'not_configured' is a real operator error (the secret was never
    // set), not a submitter mistake -- fail closed either way, same
    // posture as every other gate in this codebase: a check that cannot
    // run is never treated as passed.
    const status = turnstileResult.reason === 'not_configured' ? 500 : 400;
    return json(status, { error: 'Verification failed. Please try again.', reason: turnstileResult.reason });
  }

  const submitterEmail = String(body.submitter_email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(submitterEmail)) {
    return json(400, { error: 'A valid contact email is required.' });
  }

  // The organizer's own submitted event page IS the source of these
  // facts for a Tier 3 submission -- there is no separate "source"
  // distinct from what they are telling us, unlike a crawled row.
  const input = { ...body, source_url: body.source_url || body.registration_url };
  const { ok, errors, value } = validateEventInput(input);
  if (!ok) return json(400, { error: 'Some fields need attention.', errors });
  if (!value.registration_url || !isHttpUrl(value.registration_url, { httpsOnly: true })) {
    return json(400, { error: 'A real https:// registration link is required.', errors: { registration_url: 'Required, must start with https://' } });
  }

  // Live-check the organizer's OWN link, with their own consent -- this
  // is not the crawl-law liveness re-check (scout/src/linkcheck.js),
  // which exists specifically because fetching a THIRD PARTY's page
  // needs a terms review first. An organizer handing us their own URL on
  // purpose has no such barrier; still never fetch registration/checkout
  // pages that belong to someone who did NOT hand it to us themselves.
  let linkCheckMethod = 'structural';
  try {
    const linkRes = await fetch(value.registration_url, { method: 'GET', redirect: 'follow' });
    if (linkRes.ok) linkCheckMethod = 'live';
  } catch {
    // Unreachable right now is not proof the event is fake -- keep the
    // submission, just record the weaker method, same distinction the
    // schema already draws for crawled rows.
  }

  const geocoded = await geocode(value, env).catch(() => null);
  // 'system:submissions' -- the schema's own review_log_checks trigger
  // (core_schema.sql) only ever accepts an active reviewer's own email
  // or a 'system:%' actor; there is no third category for an anonymous
  // public submitter, and that trigger is correct to refuse one (a
  // human-shaped actor that isn't a real reviewer is exactly the kind of
  // impersonation it exists to catch). The submitter's own contact email
  // is fully preserved for follow-up in after_json instead, same place
  // console's own hand-entry already records its own provenance.
  const result = await addEvent(env.DB, value, 'system:submissions', geocoded, {
    state_source: 'scraped',
    link_check_method: linkCheckMethod,
    logSource: 'public organizer submission',
    logExtra: { submitter_email: submitterEmail },
  });

  return json(201, result);
}
