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

import { groundPage } from './grounding.js';
import { FetchRefused } from './fetcher.js';
import { gatedFetch } from './fetchgate.js';
import { parserForSource } from './parsers/index.js';

/**
 * @param {object} deps
 * @param {number} deps.now
 * @param {Function} deps.fetchImpl - (url, options) => Response, the real
 *   fetch or an injected fake, matching fetcher.js's own convention.
 * @param {Function} deps.loadActiveAliasesWithSource - async () => Array<{
 *   aliasId, host, listingPath, source: <a full `sources` row> }>
 * @param {Function} deps.claimSlot - async (source) => boolean, the full
 *   `sources` row (its own real Crawl-delay lives on it) bound to a real db.
 * @param {Function} deps.enqueueDiscovered - async ({ sourceId, host, urls }) => void
 * @param {Function} [deps.recordSkip] - (host, reason) => void, optional
 *   observability hook; discovery does not fail a whole run over one
 *   host's own refusal.
 * @param {Function} [deps.deactivateSource] - async (sourceId, reason) =>
 *   void, called on an explicit 403: per the terms review, a 403 is an
 *   answer that stops that host, not a page to retry tomorrow (Opus
 *   review, 2026-09-19, B12). Defaults to a no-op only for callers (tests)
 *   that don't care; the real crawl always wires this to a real pause.
 * @returns {Promise<{ attempted: number, discovered: number, skipped: Array<{host:string, reason:string}>, deactivated: string[] }>}
 */
export async function runDiscovery({ now, fetchImpl, loadActiveAliasesWithSource, claimSlot, enqueueDiscovered, upsertListingDrafts, recordSkip = () => {}, deactivateSource = async () => {} }) {
  if (typeof fetchImpl !== 'function') throw new Error('runDiscovery requires an injected fetchImpl');
  if (typeof loadActiveAliasesWithSource !== 'function') throw new Error('runDiscovery requires loadActiveAliasesWithSource');
  if (typeof claimSlot !== 'function') throw new Error('runDiscovery requires claimSlot');
  if (typeof enqueueDiscovered !== 'function') throw new Error('runDiscovery requires enqueueDiscovered');

  const aliases = await loadActiveAliasesWithSource();
  let attempted = 0;
  let discovered = 0;
  let drafted = 0;
  const skipped = [];
  const unresolved = [];
  const deactivated = [];
  // Per-company, for this run only: a 403/429/503 from one alias is a
  // signal about the COMPANY (section 9's shared clock is per-company for
  // the same reason), so the next alias of the same company is not hit
  // again a moment later (Opus review, 2026-09-19, B12). Reset every
  // invocation -- a fresh night gets a fresh chance, except a 403, which
  // deactivateSource makes durable across runs too.
  const backedOff = new Set();

  // All active aliases of the same source: parseListingPage accepts a link
  // to ANY of the company's reviewed subdomains (section 9: one company
  // review, many hostnames), and the fetch gate needs the same list to know
  // which hosts and listing paths are reviewed at all.
  const aliasesBySource = {};
  for (const a of aliases) (aliasesBySource[a.source.id] ??= []).push({ host: a.host, listingPath: a.listingPath });

  for (const alias of aliases) {
    if (backedOff.has(alias.source.id)) {
      skipped.push({ host: alias.host, reason: 'this company backed off earlier in this same run; not tried again tonight' });
      continue;
    }

    // Whether this may be fetched at all -- terms gate, active alias,
    // reviewed listing path, the shared clock -- is decided in ONE place,
    // fetchgate.js, never here (founder ruling, 2026-09-21).
    const listingUrl = `https://${alias.host}${alias.listingPath}`;
    let result;
    try {
      // eslint-disable-next-line no-await-in-loop -- rate-limited, sequential on purpose
      result = await gatedFetch(listingUrl, { source: alias.source, aliases: aliasesBySource[alias.source.id], fetchImpl, claimSlot, now });
    } catch (err) {
      attempted += 1;
      skipped.push({ host: alias.host, reason: err instanceof FetchRefused ? `listing fetch refused: ${err.message}` : `fetch failed: ${err?.message ?? err}` });
      continue;
    }
    if (result.refused) {
      skipped.push({ host: alias.host, reason: result.refused.reason });
      recordSkip(alias.host, result.refused.reason);
      continue;
    }
    if (result.rateLimited) {
      skipped.push({ host: alias.host, reason: 'rate limit slot already claimed (by this run or a concurrent one)' });
      continue;
    }
    attempted += 1;
    const { response } = result;
    const parser = parserForSource(alias.source);

    if (response.status === 403) {
      backedOff.add(alias.source.id);
      deactivated.push(alias.source.id);
      skipped.push({ host: alias.host, reason: 'http 403; the host said no -- this source is being paused for human review, not retried' });
      // eslint-disable-next-line no-await-in-loop
      await deactivateSource(alias.source.id, `discovery got http 403 from ${alias.host}`);
      continue;
    }
    if (response.status === 429 || response.status === 503) {
      backedOff.add(alias.source.id);
      skipped.push({ host: alias.host, reason: `http ${response.status}; backing off this company for the rest of tonight's run` });
      continue;
    }

    const grounding = groundPage(response);
    if (!grounding.grounded) {
      skipped.push({ host: alias.host, reason: `listing page not grounded: ${grounding.reason}` });
      continue;
    }

    // A 'listing_only' source (founder ruling, 2026-09-20: Smoothcomp's
    // event pages 403 us, so "build drafts from listing data only, and
    // never fetch the event page") turns this one listing fetch straight
    // into draft rows. No discovered_pages entry is made for it -- there is
    // no second fetch to queue, and a queue of pages nobody may fetch is a
    // lie about what this crawl intends to do.
    if (alias.source.crawl_mode === 'listing_only') {
      if (typeof upsertListingDrafts !== 'function') {
        skipped.push({ host: alias.host, reason: 'this source is listing_only but no listing-draft writer was wired in' });
        continue;
      }
      const { events, dropped: listingDropped } = parser.parseListingEvents(response.body, {
        url: listingUrl,
        allowedHosts: aliasesBySource[alias.source.id].map((a) => a.host),
      });
      // eslint-disable-next-line no-await-in-loop
      const outcome = await upsertListingDrafts({ source: alias.source, host: alias.host, events });
      discovered += events.length;
      drafted += outcome?.written ?? 0;
      for (const u of outcome?.unresolved ?? []) unresolved.push(u);
      for (const d of listingDropped) skipped.push({ host: alias.host, reason: `listing entry dropped: ${d.reason}` });
      continue;
    }

    const { eventUrls } = parser.parseListingPage(response.body, {
      url: listingUrl,
      allowedHosts: aliasesBySource[alias.source.id].map((a) => a.host),
    });
    if (eventUrls.length > 0) {
      // eslint-disable-next-line no-await-in-loop
      await enqueueDiscovered({ sourceId: alias.source.id, host: alias.host, urls: eventUrls });
      discovered += eventUrls.length;
    }
  }

  return { attempted, discovered, drafted, skipped, unresolved, deactivated };
}
