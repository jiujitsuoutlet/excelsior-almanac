// Daily robots.txt drift check, per active alias (ARCHITECTURE.md section
// 9 rule 4; MAD v2.54 decision 6; Opus review, 2026-09-19, B3: "robots.txt
// is never fetched, re-read, or checked by anything that runs" -- only a
// hand-run script ever touched it, so a robots.txt change on any alias
// was invisible forever, and the terms review's own promise ("the scout
// respects robots.txt, re-read daily") was not true of the real crawl
// path).
//
// Deliberately conservative, same posture as gate.js/grounding.js: this
// module decides nothing about what "different" means beyond a byte-exact
// hash mismatch, and on any mismatch it PAUSES the alias rather than
// guessing whether the change matters. A paused alias needs a human to
// look again (checkSource/the discovery gate already refuse an inactive
// row) -- this never re-activates one on its own.

import { sha256Hex } from './fetcher.js';
import { gatedFetch } from './fetchgate.js';
import { looksLikeChallenge } from './grounding.js';

/**
 * @param {object} deps
 * @param {number} deps.now
 * @param {Function} deps.fetchImpl
 * @param {Function} deps.loadActiveAliasesWithSource - same shape discover.js uses
 * @param {Function} deps.markAliasRobotsFresh - async (aliasId, todayIso) => void
 * @param {Function} deps.pauseAliasForDrift - async (aliasId) => void
 * @returns {Promise<{ checked: number, unchanged: number, paused: Array<{host:string, reason:string}>, skipped: Array<{host:string, reason:string}> }>}
 */
export async function runRobotsRecheck({ now, fetchImpl, loadActiveAliasesWithSource, markAliasRobotsFresh, pauseAliasForDrift }) {
  for (const fn of [fetchImpl, loadActiveAliasesWithSource, markAliasRobotsFresh, pauseAliasForDrift]) {
    if (typeof fn !== 'function') throw new Error('runRobotsRecheck requires every dependency as an injected function');
  }

  const aliases = await loadActiveAliasesWithSource();
  const aliasesBySource = {};
  for (const a of aliases) if (a.source) (aliasesBySource[a.source.id] ??= []).push({ host: a.host, listingPath: a.listingPath });
  const todayIso = new Date(now).toISOString().slice(0, 10);
  let checked = 0;
  let unchanged = 0;
  const paused = [];
  const skipped = [];

  for (const alias of aliases) {
    if (!alias.robotsSha256) {
      // Activation itself requires robots_sha256 (source_aliases' own
      // CHECK), so an active alias missing it here means the loader
      // shape drifted from the schema, not a real gap -- refuse to guess.
      skipped.push({ host: alias.host, reason: 'no recorded robots.txt hash to compare against; skipping rather than guessing' });
      continue;
    }

    let response;
    try {
      // Through the one fetch gate like every other request (founder
      // ruling, 2026-09-21). A robots.txt read claims no rate-limit slot,
      // but it still needs a reviewed, active source and an active alias:
      // an operator stopping a source stops this too.
      // eslint-disable-next-line no-await-in-loop -- sequential, same discipline as every other fetch this crawl makes
      const result = await gatedFetch(`https://${alias.host}/robots.txt`, { source: alias.source, aliases: aliasesBySource[alias.source?.id] ?? [], fetchImpl, now });
      if (result.refused) {
        skipped.push({ host: alias.host, reason: result.refused.reason });
        continue;
      }
      response = result.response;
    } catch (err) {
      skipped.push({ host: alias.host, reason: `robots.txt fetch failed: ${err?.message ?? err}` });
      continue;
    }

    if (response.status === 404) {
      // No robots.txt is a real, allowed answer (robots.js's own
      // classifyRobotsFetch: 404 -> allow_all) -- but it is also a
      // change from "one existed and was reviewed", so it is drift too.
      paused.push({ host: alias.host, reason: 'robots.txt is now 404 (previously reviewed with real content); pausing for a human to re-check' });
      // eslint-disable-next-line no-await-in-loop
      await pauseAliasForDrift(alias.aliasId);
      checked += 1;
      continue;
    }

    // grounding.js's own byte floor is built for CONTENT pages -- a real
    // robots.txt is legitimately tiny (a handful of Disallow lines), so
    // that floor would reject the ordinary case, not just an
    // interstitial. Its challenge-signature check still applies: a 200
    // response carrying Cloudflare's interstitial HTML must never be
    // hashed and compared as if it were the real robots.txt.
    if (response.redirectTo || typeof response.status !== 'number' || response.status < 200 || response.status >= 300) {
      skipped.push({ host: alias.host, reason: `robots.txt fetch was not a usable 200: ${response.redirectTo ? `redirected to ${response.redirectTo}` : `http ${response.status}`}` });
      continue;
    }
    const challenge = looksLikeChallenge(response.body);
    if (challenge.challenged) {
      skipped.push({ host: alias.host, reason: `robots.txt fetch looks like ${challenge.reason}, not real content` });
      continue;
    }

    checked += 1;
    // eslint-disable-next-line no-await-in-loop
    const hash = await sha256Hex(response.body);
    if (hash === alias.robotsSha256) {
      unchanged += 1;
      // eslint-disable-next-line no-await-in-loop
      await markAliasRobotsFresh(alias.aliasId, todayIso);
    } else {
      paused.push({ host: alias.host, reason: 'robots.txt has changed since it was last reviewed; pausing for a human to re-check' });
      // eslint-disable-next-line no-await-in-loop
      await pauseAliasForDrift(alias.aliasId);
    }
  }

  return { checked, unchanged, paused, skipped };
}
