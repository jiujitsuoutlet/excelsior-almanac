// Phase 1 of the real crawl (founder ruling, 2026-09-19): fetch each
// active alias's own listing page, discover its real event-detail links,
// and enqueue them into discovered_pages for phase 2 (ingest.js) to fetch
// on its own schedule. Decoupled on purpose: a listing page can name more
// detail pages than one company's shared 10-second clock can fetch inside
// one Worker invocation's time budget, so discovery and detail-fetching
// are separate steps that can span separate runs.
//
// Every I/O boundary is injected (fetchImpl, loadActiveAliases, claimSlot,
// enqueueDiscovered, now), the same seam run.js already uses, so this can
// be unit-tested with no real network and no real database.

import { checkSource } from './gate.js';
import { groundPage } from './grounding.js';
import { fetchOnce, FetchRefused } from './fetcher.js';
import * as smoothcomp from './parsers/smoothcomp.js';

// Which parser owns a given source id. One entrant today, on purpose --
// see the identical note in ingest.js. Both files share this registry
// rather than each guessing independently.
export const PARSERS = { 'src-smoothcomp': smoothcomp };

/**
 * @param {object} deps
 * @param {number} deps.now
 * @param {Function} deps.fetchImpl - (url, options) => Response, the real
 *   fetch or an injected fake, matching fetcher.js's own convention.
 * @param {Function} deps.loadActiveAliasesWithSource - async () => Array<{
 *   aliasId, host, listingPath, source: <a full `sources` row> }>
 * @param {Function} deps.claimSlot - async (sourceId, now) => boolean,
 *   limiter.js's claimRateLimitSlot bound to a real db.
 * @param {Function} deps.enqueueDiscovered - async ({ sourceId, host, urls }) => void
 * @param {Function} [deps.recordSkip] - (host, reason) => void, optional
 *   observability hook; discovery does not fail a whole run over one
 *   host's own refusal.
 * @returns {Promise<{ attempted: number, discovered: number, skipped: Array<{host:string, reason:string}> }>}
 */
export async function runDiscovery({ now, fetchImpl, loadActiveAliasesWithSource, claimSlot, enqueueDiscovered, recordSkip = () => {} }) {
  if (typeof fetchImpl !== 'function') throw new Error('runDiscovery requires an injected fetchImpl');
  if (typeof loadActiveAliasesWithSource !== 'function') throw new Error('runDiscovery requires loadActiveAliasesWithSource');
  if (typeof claimSlot !== 'function') throw new Error('runDiscovery requires claimSlot');
  if (typeof enqueueDiscovered !== 'function') throw new Error('runDiscovery requires enqueueDiscovered');

  const aliases = await loadActiveAliasesWithSource();
  let attempted = 0;
  let discovered = 0;
  const skipped = [];

  // All active aliases of the same source, needed so parseListingPage
  // accepts a link to ANY of the company's reviewed subdomains, not just
  // the one currently being fetched (section 9: one company review, many
  // hostnames).
  const hostsBySourceId = {};
  for (const a of aliases) (hostsBySourceId[a.source.id] ??= []).push(a.host);

  for (const alias of aliases) {
    const gate = checkSource(alias.source);
    if (!gate.allowed) {
      skipped.push({ host: alias.host, reason: gate.reason });
      recordSkip(alias.host, gate.reason);
      continue;
    }
    const parser = PARSERS[alias.source.id];
    if (!parser) {
      skipped.push({ host: alias.host, reason: `no parser registered for source ${alias.source.id}` });
      continue;
    }

    // eslint-disable-next-line no-await-in-loop -- one company's clock at a time, on purpose
    const claimed = await claimSlot(alias.source.id, now);
    if (!claimed) {
      skipped.push({ host: alias.host, reason: 'rate limit slot already claimed (by this run or a concurrent one)' });
      continue;
    }

    attempted += 1;
    const listingUrl = `https://${alias.host}${alias.listingPath}`;
    // No pathAllowed callback here on purpose: listing_path is a human-
    // set value from the alias's own activation review (section 9 rule
    // 5), not a link discovered from crawled content. Every link the
    // listing page itself contains still gets the full classifyUrl/
    // EXCLUDED_PATH_RULES treatment below, via parseListingPage -- this
    // fetch is only trusted because a human already looked at this exact
    // path before it went active.

    let response;
    try {
      // eslint-disable-next-line no-await-in-loop -- rate-limited, sequential on purpose; fetcher.js enforces host-allowlist/timeout/byte-cap/redirect-refusal
      response = await fetchOnce(listingUrl, { fetchImpl, allowHost: alias.host, now: () => now });
    } catch (err) {
      if (err instanceof FetchRefused) {
        skipped.push({ host: alias.host, reason: `listing fetch refused: ${err.message}` });
      } else {
        skipped.push({ host: alias.host, reason: `fetch failed: ${err?.message ?? err}` });
      }
      continue;
    }

    const grounding = groundPage(response);
    if (!grounding.grounded) {
      skipped.push({ host: alias.host, reason: `listing page not grounded: ${grounding.reason}` });
      continue;
    }

    const { eventUrls } = parser.parseListingPage(response.body, {
      url: listingUrl,
      allowedHosts: hostsBySourceId[alias.source.id],
    });
    if (eventUrls.length > 0) {
      // eslint-disable-next-line no-await-in-loop
      await enqueueDiscovered({ sourceId: alias.source.id, host: alias.host, urls: eventUrls });
      discovered += eventUrls.length;
    }
  }

  return { attempted, discovered, skipped };
}
