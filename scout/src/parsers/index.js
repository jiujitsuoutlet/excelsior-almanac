// THE parser registry: the one place that maps a source to its parser.
// Keyed by `sources.parser` (the value the database actually holds,
// 'smoothcomp_v1'), never by source id. Until 2026-09-21 discover.js,
// ingest.js and linkcheck.js each kept their own `{ 'src-smoothcomp': ... }`
// copy keyed by id -- a fourth copy of one fact, the same shape as every
// "rule in two places, missed in a third" bug this lane has had.
//
// Holds pure parser modules only. Nothing here fetches.

import * as smoothcomp from './smoothcomp.js';

export const PARSERS = {
  smoothcomp_v1: smoothcomp,
};

// Returns undefined for an unknown name rather than throwing, so a caller can
// report "no parser registered" as an ordinary condition, not a crash.
export function parserFor(name) {
  return PARSERS[name];
}

export function parserForSource(source) {
  return source ? PARSERS[source.parser] : undefined;
}
