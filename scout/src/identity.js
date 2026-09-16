// How the scout identifies itself to every site it touches.
//
// Ratified by the founder on 2026-09-16. This exact string appears in the
// access log of every site the scout fetches, on every request, robots.txt
// included. It carries a working contact address on the founder's own domain,
// so a site admin who wants us to stop can reach a person the same day.
//
// There is deliberately no "+https://" link yet: a link that returns 404 reads
// worse in a log than no link at all. When the bot information page exists
// (what the bot is, what it fetches, the crawl delay, how to ask us to stop),
// the string becomes:
//   ExcelsiorAlmanacBot/1.0 (+https://jiujitsuoutlet.com/almanac-bot; contact paul@jiujitsuoutlet.com)
// and that change rides its own pull request.
export const USER_AGENT = 'ExcelsiorAlmanacBot/1.0 (Outlet Academy events database; contact paul@jiujitsuoutlet.com)';

// The token a robots.txt group must name to bind us. Matching is
// case-insensitive and by prefix, per the robots convention.
export const ROBOTS_TOKEN = 'ExcelsiorAlmanacBot';
