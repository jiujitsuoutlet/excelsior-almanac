// Tier 1 parser registry. Maps a `sources.parser` value to the pure parser
// functions for that host, so `queue.js` and `run.js` can look one up by
// name. This module wires nothing to a network: it holds only the pure
// `parseEventPage` / `parseListingPage` / `toDraftRow` functions themselves.
// No fetch happens here, and nothing here is called yet from run.js.

import * as smoothcomp from './smoothcomp.js';

export const PARSERS = {
  smoothcomp_v1: {
    parseEventPage: smoothcomp.parseEventPage,
    parseListingPage: smoothcomp.parseListingPage,
    toDraftRow: smoothcomp.toDraftRow,
  },
};

// Looks up a parser by the `sources.parser` value. Returns undefined for an
// unknown name rather than throwing, so a caller can report "no parser
// registered for this source" as an ordinary condition, not a crash.
export function parserFor(name) {
  return PARSERS[name];
}
