// The terms-review gate. Given one row from the `sources` table, decides
// whether the scout may crawl that host at all. This is a second,
// independent check of the same rule the database's own CHECK constraint on
// `sources.active` enforces (migrations/20260915000100_core_schema.sql): it
// exists so the reason a host is refused can be read in plain English by an
// operator, before any network call is even considered, and so the rule can
// be tested without a database.
//
// The ten fields are ARCHITECTURE.md section 9 / MAD v2.54 decision 6, word
// for word. Field numbers below match that list.

const REQUIRED_FIELDS = [
  { field: 'page_types', present: (s) => truthy(s.page_types), reason: 'the page types to fetch have not been recorded (field 1)' },
  { field: 'terms_url', present: (s) => truthy(s.terms_url), reason: 'the terms URL has not been recorded (field 2)' },
  { field: 'terms_last_updated', present: (s) => truthy(s.terms_last_updated), reason: "the terms' own last-updated date has not been recorded (field 2)" },
  { field: 'terms_read_on', present: (s) => truthy(s.terms_read_on), reason: 'the date the terms were read has not been recorded (field 2)' },
  { field: 'terms_automated_access', present: (s) => truthy(s.terms_automated_access), reason: 'whether the terms prohibit automated access has not been recorded (field 3)' },
  { field: 'terms_reuse', present: (s) => truthy(s.terms_reuse), reason: 'whether the terms restrict reuse of listing facts has not been recorded (field 4)' },
  { field: 'login_required', present: (s) => s.login_required === 0 || s.login_required === 1, reason: 'whether the site requires a login has not been recorded (field 5)' },
  { field: 'official_api', present: (s) => truthy(s.official_api), reason: 'whether the host offers an official API has not been recorded (field 6)' },
  { field: 'excluded_paths', present: (s) => truthy(s.excluded_paths), reason: 'the paths to exclude have not been recorded (field 7)' },
  { field: 'robots_disallowed', present: (s) => truthy(s.robots_disallowed), reason: 'robots.txt has not been read and recorded (field 8)' },
  { field: 'robots_sha256', present: (s) => truthy(s.robots_sha256), reason: 'the robots.txt hash has not been recorded (field 8)' },
  { field: 'robots_read_on', present: (s) => truthy(s.robots_read_on), reason: 'the date robots.txt was read has not been recorded (field 8)' },
  { field: 'verdict', present: (s) => truthy(s.verdict), reason: 'no terms-review verdict has been recorded (field 9)' },
  { field: 'reviewed_by', present: (s) => truthy(s.reviewed_by), reason: 'no reviewer name has been recorded (field 10)' },
  { field: 'reviewed_on', present: (s) => truthy(s.reviewed_on), reason: 'no review date has been recorded (field 10)' },
];

// Exported so a test can compare this list against the database's own CHECK
// constraint. Two lists that must agree, with nothing checking them, is the
// exact shape of the bugs the founder found by hand.
export const GATE_REQUIRED_FIELDS = REQUIRED_FIELDS.map((f) => f.field);

// Fields the gate enforces with their own rule rather than a presence check.
export const GATE_CONDITIONAL_FIELDS = ['verdict_conditions'];

function truthy(value) {
  return value !== null && value !== undefined && value !== '';
}

// Decides whether `source` (a row shaped like the `sources` table) may be
// crawled right now. Returns { allowed: true } or { allowed: false, reason }.
// The reason names the single most useful thing to fix next: a missing
// field first (nothing else can be judged without it), then a disallowing
// verdict or a login requirement (the review is complete, but it says no),
// and only last the `active` flag itself, since an operator can pause a
// fully-reviewed, allowed host without touching its review.
export function checkSource(source) {
  const s = source ?? {};

  for (const field of REQUIRED_FIELDS) {
    if (!field.present(s)) return { allowed: false, reason: `This host cannot be crawled: ${field.reason}.` };
  }

  if (s.verdict === 'allowed_with_conditions' && !truthy(s.verdict_conditions)) {
    return { allowed: false, reason: 'This host cannot be crawled: the allowed-with-conditions verdict has no conditions recorded (field 9).' };
  }

  if (s.login_required === 1) {
    return { allowed: false, reason: 'This host cannot be crawled: the site requires a login (field 5).' };
  }

  if (s.verdict === 'not_allowed') {
    return { allowed: false, reason: 'This host cannot be crawled: the terms-review verdict is not_allowed (field 9).' };
  }

  if (s.verdict !== 'allowed' && s.verdict !== 'allowed_with_conditions') {
    return { allowed: false, reason: `This host cannot be crawled: the terms-review verdict is "${s.verdict}", not allowed or allowed_with_conditions (field 9).` };
  }

  if (s.active !== 1) {
    return { allowed: false, reason: 'This host cannot be crawled: the source is not marked active.' };
  }

  return { allowed: true };
}
