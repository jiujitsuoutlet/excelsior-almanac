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

import { groundPage } from './grounding.js';
import { fetchOnce, FetchRefused } from './fetcher.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {object} deps
 * @param {number} deps.now
 * @param {Function} deps.fetchImpl
 * @param {Function} deps.claimSlot - async (sourceId, now) => boolean; only
 *   called for a link whose host is a known, reviewed alias/source (see
 *   loadStaleApprovedLinks below) -- a link on an unreviewed host is
 *   never fetched at all, live-checked or otherwise.
 * @param {Function} deps.loadStaleApprovedLinks - async (staleBeforeIso) =>
 *   Array<{ id, registrationUrl, host, sourceId, source: <sources row> }>,
 *   already filtered to links whose host matches a reviewed source/alias.
 * @param {Function} deps.markLinkLive - async (eventId, nowIso) => void
 * @param {Function} deps.demoteDeadLink - async (eventId, nowIso, reason, actor) => void
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
  let demoted = 0;
  const skipped = [];
  const nowIso = new Date(now).toISOString();

  for (const link of links) {
    // eslint-disable-next-line no-await-in-loop -- one company's clock at a time, same discipline as discovery/ingest
    const claimed = await claimSlot(link.sourceId, now);
    if (!claimed) {
      skipped.push({ id: link.id, reason: 'rate limit slot already claimed' });
      continue;
    }

    let response;
    let refusalReason = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      response = await fetchOnce(link.registrationUrl, { fetchImpl, allowHost: link.host, now: () => now });
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

    const grounding = groundPage(response);
    if (grounding.grounded) {
      // eslint-disable-next-line no-await-in-loop
      await markLinkLive(link.id, nowIso);
      confirmedLive += 1;
    } else {
      // eslint-disable-next-line no-await-in-loop
      await demoteDeadLink(link.id, nowIso, `registration link no longer grounds: ${grounding.reason}`, 'system:scout-linkcheck');
      demoted += 1;
    }
  }

  return { checked, confirmedLive, demoted, skipped };
}
