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

import { structuralLinkVerdict } from './structural.js';
import { groundPage } from './grounding.js';
import { gatedFetch } from './fetchgate.js';
import { parserForSource } from './parsers/index.js';

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
  aliasesBySource = {},
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
  let demoted = 0;
  const skipped = [];
  const nowIso = new Date(now).toISOString();
  // Same per-run backoff discipline as discover.js/ingest.js (Opus
  // review, 2026-09-19, B12).
  const backedOff = new Set();

  for (const link of links) {
    if (backedOff.has(link.source.id)) {
      skipped.push({ id: link.id, reason: 'this company backed off earlier in this same run; not tried again tonight' });
      continue;
    }
    const aliases = aliasesBySource[link.source.id] ?? [];

    // Whether the event page may be fetched is decided in ONE place,
    // fetchgate.js (founder ruling, 2026-09-21) -- never by this row's own
    // link_check_method, which is exactly the key that let a legacy NULL
    // row live-fetch a Smoothcomp event page in production.
    let result;
    let thrown = null;
    try {
      // eslint-disable-next-line no-await-in-loop -- one company's clock at a time, same discipline as discovery/ingest
      result = await gatedFetch(link.sourceUrl, { source: link.source, aliases, fetchImpl, claimSlot, now });
    } catch (err) {
      thrown = `fetch failed: ${err?.message ?? err}`;
    }

    if (result?.refused?.code === 'listing_only') {
      // The event page may never be fetched, so this is the weaker check,
      // named honestly (founder ruling, 2026-09-20): well-formed, https, on
      // one of this source's own active aliases, and nothing more. The
      // approved hosts are the source's real aliases, not hosts read back
      // off the rows being checked -- that would let a row vouch for itself.
      const verdict = structuralLinkVerdict(link.registrationUrl ?? link.sourceUrl, new Set(aliases.map((a) => a.host)));
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
    if (result?.refused) {
      // Our own refusal is not evidence about the link (Opus review, B9):
      // skip, never demote.
      skipped.push({ id: link.id, reason: result.refused.reason });
      continue;
    }
    if (result?.rateLimited) {
      skipped.push({ id: link.id, reason: 'rate limit slot already claimed' });
      continue;
    }
    checked += 1;
    if (thrown) {
      // eslint-disable-next-line no-await-in-loop
      await demoteDeadLink(link.id, nowIso, thrown, 'system:scout-linkcheck');
      demoted += 1;
      continue;
    }
    const { response } = result;
    const parser = parserForSource(link.source);

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
