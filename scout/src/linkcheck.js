// Link liveness (founder ruling, 2026-09-19; ARCHITECTURE.md section 9's
// "a link re-check of published rows daily"; the finish brief's own
// words: "previously cached approval must not authorize a now-withdrawn
// event"). A registration link that was real when a human approved the
// row can go dead later -- the event gets cancelled, the organizer
// changes platforms, the URL rots. Nothing else in this crawl ever
// re-checks an approved row's own claim once it is live.
//
// Deliberately conservative about what a check PROVES. fetcher.js's
// fetchOnce() never follows a redirect (the destination is a path
// nobody reviewed), so a redirect here is not evidence the link is dead
// -- many real registration flows redirect once, into a login or
// checkout step -- but it is also not proof the link still works. Per
// the brief: "A challenge, timeout, HTTP 200 login page, or unrelated
// redirect is not proof of a working registration page." An
// inconclusive result demotes the row for a human to look at again,
// exactly like a re-crawl finding real content changes -- it never
// silently stays approved on unproven grounds, and it never gets
// rejected outright on an automated guess either.
//
// Re-fetches the event's SOURCE_URL (the event detail page), never
// registration_url directly (Opus review, 2026-09-19, B1/B9): a
// registration_url is typically an /order/ or /checkout path -- exactly
// the page type the terms review says to never fetch, and fetching it
// here for a "liveness" check was itself a terms-review violation, not
// just a false-positive risk. The event detail page is always an
// EVENT_DETAIL_PATH page (the one type this crawl is reviewed to
// re-touch); the check re-parses it and confirms a registration link is
// still present, which is the real liveness signal without ever
// requesting the registration/checkout flow itself.

import { checkSource } from './gate.js';
import { structuralLinkVerdict } from './structural.js';
import { groundPage } from './grounding.js';
import { fetchOnce, FetchRefused } from './fetcher.js';
import * as smoothcomp from './parsers/smoothcomp.js';

export const PARSERS = { 'src-smoothcomp': smoothcomp };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {object} deps
 * @param {number} deps.now
 * @param {Function} deps.fetchImpl
 * @param {Function} deps.claimSlot - async (source) => boolean; only
 *   called for a link whose host is a known, reviewed alias/source (see
 *   loadStaleApprovedLinks below) -- a link on an unreviewed host is
 *   never fetched at all, live-checked or otherwise.
 * @param {Function} deps.loadStaleApprovedLinks - async (staleBeforeIso) =>
 *   Array<{ id, sourceUrl, host, sourceId, source: <sources row> }>,
 *   already filtered to links whose host matches a reviewed source/alias.
 * @param {Function} deps.markLinkLive - async (eventId, nowIso) => void
 * @param {Function} deps.demoteDeadLink - async (eventId, nowIso, reason, actor) => void
 * @param {Function} [deps.deactivateSource] - async (sourceId, reason) => void
 * @param {number} [deps.staleAfterMs]
 * @param {number} [deps.maxChecks]
 */
export async function runLinkCheck({
  now,
  fetchImpl,
  claimSlot,
  loadStaleApprovedLinks,
  markLinkLive,
  demoteDeadLink,
  deactivateSource = async () => {},
  staleAfterMs = DAY_MS,
  maxChecks = 50,
}) {
  for (const fn of [fetchImpl, claimSlot, loadStaleApprovedLinks, markLinkLive, demoteDeadLink]) {
    if (typeof fn !== 'function') throw new Error('runLinkCheck requires every dependency as an injected function');
  }

  const staleBeforeIso = new Date(now - staleAfterMs).toISOString();
  const links = await loadStaleApprovedLinks(staleBeforeIso, maxChecks);

  let checked = 0;
  let confirmedLive = 0;
  let structural = 0;
  const approvedHosts = new Set(links.map((l) => l.host));
  let demoted = 0;
  const skipped = [];
  const nowIso = new Date(now).toISOString();
  // Same per-run backoff discipline as discover.js/ingest.js (Opus
  // review, 2026-09-19, B12).
  const backedOff = new Set();

  for (const link of links) {
    // The terms-review gate, same check discover.js/ingest.js already
    // make (Opus review, 2026-09-19, B2): link-check never had this at
    // all, so setting a source inactive to stop crawling it left the
    // daily re-check still hitting the host forever.
    const gate = checkSource(link.source);
    if (!gate.allowed) {
      skipped.push({ id: link.id, reason: gate.reason });
      continue;
    }
    const parser = PARSERS[link.source.id];
    if (!parser) {
      skipped.push({ id: link.id, reason: `no parser registered for source ${link.source.id}` });
      continue;
    }
    if (backedOff.has(link.source.id)) {
      skipped.push({ id: link.id, reason: 'this company backed off earlier in this same run; not tried again tonight' });
      continue;
    }

    // A structurally-checked row (founder ruling, 2026-09-20) is never
    // fetched: its registration URL is a Smoothcomp event page, and those
    // 403 us. All this can honestly confirm is that the URL is well-formed,
    // https, and on an approved alias -- so that is all it claims, and
    // link_check_method stays 'structural' on the row so the console can
    // render it as the weaker thing it is. No slot is claimed, because no
    // request is made.
    if (link.linkCheckMethod === 'structural') {
      const verdict = structuralLinkVerdict(link.registrationUrl ?? link.sourceUrl, approvedHosts);
      if (verdict.ok) {
        // eslint-disable-next-line no-await-in-loop
        await markLinkLive(link.id, nowIso, 'structural');
        structural += 1;
      } else {
        // eslint-disable-next-line no-await-in-loop
        await demoteDeadLink(link.id, nowIso, `structural link check failed: ${verdict.reason}`, 'system:scout-linkcheck');
        demoted += 1;
      }
      checked += 1;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop -- one company's clock at a time, same discipline as discovery/ingest
    const claimed = await claimSlot(link.source, now);
    if (!claimed) {
      skipped.push({ id: link.id, reason: 'rate limit slot already claimed' });
      continue;
    }

    let response;
    let refusalReason = null;
    try {
      // Re-checks the EVENT DETAIL page (source_url), never the
      // registration_url directly (B1/B9): a registration_url is
      // typically an excluded /order/ path, and fetching it here was
      // both a terms-review violation and, when it pointed off-host, a
      // false "dead link" demotion caused by our own allowlist refusal
      // rather than any real evidence.
      // eslint-disable-next-line no-await-in-loop
      response = await fetchOnce(link.sourceUrl, {
        fetchImpl,
        allowHost: link.host,
        pathAllowed: (p) => parser.pathAllowed(p, { host: link.host }),
        now: () => now,
      });
    } catch (err) {
      refusalReason = err instanceof FetchRefused ? `fetch refused: ${err.message}` : `fetch failed: ${err?.message ?? err}`;
    }
    checked += 1;

    if (refusalReason) {
      // eslint-disable-next-line no-await-in-loop
      await demoteDeadLink(link.id, nowIso, refusalReason, 'system:scout-linkcheck');
      demoted += 1;
      continue;
    }

    if (response.status === 403) {
      backedOff.add(link.source.id);
      skipped.push({ id: link.id, reason: 'http 403; the host said no -- this source is being paused for human review, not retried' });
      // eslint-disable-next-line no-await-in-loop
      await deactivateSource(link.source.id, `link-check got http 403 from ${link.host}`);
      continue;
    }
    if (response.status === 429 || response.status === 503) {
      backedOff.add(link.source.id);
      skipped.push({ id: link.id, reason: `http ${response.status}; backing off this company for the rest of tonight's run` });
      continue;
    }

    const grounding = groundPage(response);
    if (!grounding.grounded) {
      // eslint-disable-next-line no-await-in-loop
      await demoteDeadLink(link.id, nowIso, `event page no longer grounds: ${grounding.reason}`, 'system:scout-linkcheck');
      demoted += 1;
      continue;
    }

    const parsed = parser.parseEventPage(response.body, { url: link.sourceUrl });
    if (parsed.ok && parsed.event.registrationUrl) {
      // eslint-disable-next-line no-await-in-loop
      await markLinkLive(link.id, nowIso, 'live');
      confirmedLive += 1;
    } else {
      const reason = parsed.ok
        ? 'the event page no longer shows a registration link'
        : `the event page no longer parses: ${parsed.reason}`;
      // eslint-disable-next-line no-await-in-loop
      await demoteDeadLink(link.id, nowIso, reason, 'system:scout-linkcheck');
      demoted += 1;
    }
  }

  return { checked, confirmedLive, structural, demoted, skipped };
}
