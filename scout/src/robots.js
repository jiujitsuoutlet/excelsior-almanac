// A pure robots.txt parser and matcher. No network here: this module only
// turns text that was already fetched into rules, and answers whether one
// path is allowed for one user agent. Whether and how to fetch robots.txt is
// entirely the caller's job.
//
// Grouping follows the common robots.txt convention: one or more
// "User-agent" lines start a record; the Allow, Disallow and Crawl-delay
// lines that follow, up to the next User-agent line, belong to every agent
// named in that record. "Sitemap" lines are global, not part of any group.
// Unrecognized lines and comments (from "#" to end of line) are ignored, so
// a malformed file degrades to "fewer rules", never to a thrown error.

export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let currentAgents = [];
  let currentGroup = null; // the group being filled for currentAgents, once a rule line starts it

  const lines = String(text ?? '').split(/\r\n|\r|\n/);
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const sep = line.indexOf(':');
    if (sep === -1) continue; // a line with no field: value shape carries no rule
    const field = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();

    if (field === 'user-agent') {
      if (currentGroup !== null) {
        // A User-agent line after this record already has rules: that starts
        // a fresh record, even if the agent name repeats.
        currentAgents = [];
        currentGroup = null;
      }
      if (value) currentAgents.push(value.toLowerCase());
      continue;
    }
    if (field === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }
    if (currentAgents.length === 0) continue; // a rule with no user-agent yet declared applies to nothing

    if (field === 'allow' || field === 'disallow') {
      if (currentGroup === null) {
        currentGroup = { userAgents: [...currentAgents], rules: [], crawlDelay: null };
        groups.push(currentGroup);
      }
      // An empty Disallow value is the documented "allow everything" shape:
      // recording no rule for it has the same effect as allowing.
      if (value !== '') currentGroup.rules.push({ type: field, path: value });
      continue;
    }
    if (field === 'crawl-delay') {
      if (currentGroup === null) {
        currentGroup = { userAgents: [...currentAgents], rules: [], crawlDelay: null };
        groups.push(currentGroup);
      }
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) currentGroup.crawlDelay = seconds;
      continue;
    }
    // Any other directive (Host, Request-rate, Visit-time, ...) is ignored.
  }
  return { groups, sitemaps };
}

// The groups that apply to `userAgent`: every group naming the most
// specific token that matches (the longest declared token that is a
// substring of our agent name), or, when no group names us specifically,
// every "*" group. A robots.txt that repeats a group for the same agent is
// common; all of those groups apply together, not just the first one found.
export function matchingGroups(parsed, userAgent) {
  const ua = String(userAgent ?? '').toLowerCase();
  let bestLength = -1;
  const specific = [];
  const wildcard = [];
  for (const group of parsed?.groups ?? []) {
    let matchedLength = -1;
    for (const token of group.userAgents) {
      if (token === '*') continue;
      if (token && ua.includes(token)) matchedLength = Math.max(matchedLength, token.length);
    }
    if (group.userAgents.includes('*')) wildcard.push(group);
    if (matchedLength === -1) continue;
    if (matchedLength > bestLength) {
      bestLength = matchedLength;
      specific.length = 0;
      specific.push(group);
    } else if (matchedLength === bestLength) {
      specific.push(group);
    }
  }
  return specific.length > 0 ? specific : wildcard;
}

// Longest-match wins, across every matching group combined. An empty or
// missing Disallow, a 404 robots.txt (an empty parsed result), or no rule
// that matches the path at all: allowed. Equal-length Allow and Disallow
// rules resolve to Allow.
export function isAllowed(parsed, path, userAgent) {
  const groups = matchingGroups(parsed, userAgent);
  const target = String(path ?? '');
  let best = null;
  for (const group of groups) {
    for (const rule of group.rules) {
      if (!target.startsWith(rule.path)) continue;
      const length = rule.path.length;
      if (!best || length > best.length || (length === best.length && rule.type === 'allow')) {
        best = { type: rule.type, length };
      }
    }
  }
  return !best || best.type === 'allow';
}

// The Crawl-delay that applies to `userAgent`, or null when no matching
// group declares one. When matching groups disagree, the longer delay wins:
// the crawl law is a minimum wait, and guessing short is the unsafe guess.
export function crawlDelayFor(parsed, userAgent) {
  const groups = matchingGroups(parsed, userAgent);
  let delay = null;
  for (const group of groups) {
    if (group.crawlDelay !== null && (delay === null || group.crawlDelay > delay)) delay = group.crawlDelay;
  }
  return delay;
}

// How a caller should treat the HTTP status of a robots.txt fetch. This
// function makes no request itself; it only names the rule so every caller
// applies it the same way (MAD v2.54 decision 6 / ARCHITECTURE.md section 9):
//   404            -> "allow_all"  (no robots.txt means no restriction)
//   500-599        -> "skip_host"  (a server error means skip this host)
//   200-299        -> "parse"      (read the body with parseRobots)
//   anything else  -> "skip_host"  (conservative default; never guess allow)
export function classifyRobotsFetch(status) {
  const code = Number(status);
  if (code === 404) return 'allow_all';
  if (code >= 200 && code < 300) return 'parse';
  if (code >= 500 && code < 600) return 'skip_host';
  return 'skip_host';
}
