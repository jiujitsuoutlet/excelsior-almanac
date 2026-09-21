// Pure logic for the ALMANAC console. No I/O here, so every rule is unit-testable.

export const SECONDS_PER_ROW = 20;

export const EVENT_TYPES = ['tournament', 'superfight', 'seminar', 'camp', 'open_competition'];

// Reject reasons, keyed by the number the reviewer presses after R.
export const REJECT_REASONS = {
  1: { code: 'not_real_event', label: 'Not a real or public event' },
  2: { code: 'wrong_date', label: 'Wrong date' },
  3: { code: 'wrong_place', label: 'Wrong place' },
  4: { code: 'bad_link', label: 'Bad link' },
  5: { code: 'duplicate', label: 'Duplicate' },
  6: { code: 'out_of_scope', label: 'Out of scope (for example members-only)' },
};

// The fields that must be confirmed on the source page for a plain A.
export const CRITICAL_FIELDS = ['name', 'start_date', 'location', 'registration_url'];

// Fields a reviewer may edit on a row that is not approved.
export const EDITABLE_FIELDS = [
  'event_type', 'name', 'organizer_name', 'start_date', 'end_date', 'venue_name', 'address',
  'city', 'state', 'country', 'registration_url', 'registration_deadline', 'gi', 'nogi', 'kids',
];

export function queueHeadline(count) {
  if (count === 0) return 'Nothing to review';
  const minutes = Math.max(1, Math.ceil((count * SECONDS_PER_ROW) / 60));
  const rows = count === 1 ? '1 row' : `${count} rows`;
  return `${rows}, about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function dedupeKey(event) {
  return [
    normalizeText(event.name),
    event.start_date,
    event.country,
    event.state,
    normalizeText(event.city),
  ].join('|');
}

// Token overlap between two names (Jaccard), after normalizing.
export function nameSimilarity(a, b) {
  const ta = new Set(normalizeText(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeText(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

export function isRealDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isHttpUrl(value, { httpsOnly = false } = {}) {
  try {
    const u = new URL(value);
    if (u.username || u.password) return false;
    return httpsOnly ? u.protocol === 'https:' : u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export function hostOf(url) {
  return new URL(url).hostname.toLowerCase();
}

function text(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (s === '') return null;
  return s.length <= max ? s : undefined;
}

// Validates and normalizes a hand-entered or edited event. Returns
// { ok, errors: {field: message}, value }.
export function validateEventInput(input, { partial = false } = {}) {
  const errors = {};
  const value = {};
  const has = (f) => Object.prototype.hasOwnProperty.call(input, f);
  const need = (f) => !partial || has(f);

  if (need('event_type')) {
    if (EVENT_TYPES.includes(input.event_type)) value.event_type = input.event_type;
    else errors.event_type = 'Choose an event type';
  }
  if (need('name')) {
    const v = text(input.name, 200);
    if (v) value.name = v; else errors.name = 'Name is required (200 characters at most)';
  }
  if (need('start_date')) {
    if (isRealDate(input.start_date)) value.start_date = input.start_date;
    else errors.start_date = 'Start date must be a real date, YYYY-MM-DD';
  }
  if (has('end_date')) {
    if (!input.end_date) value.end_date = null;
    else if (isRealDate(input.end_date)) value.end_date = input.end_date;
    else errors.end_date = 'End date must be a real date, YYYY-MM-DD';
  }
  if (need('city')) {
    const v = text(input.city, 120);
    if (v) value.city = v; else errors.city = 'City is required';
  }
  if (need('state')) {
    const v = String(input.state ?? '').trim().toUpperCase();
    if (/^[A-Z0-9]{1,3}$/.test(v)) value.state = v;
    else errors.state = 'State is the ISO 3166-2 subdivision part, for example MO';
  }
  if (need('country')) {
    const v = String(input.country ?? 'US').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(v)) value.country = v;
    else errors.country = 'Country is a two-letter code, for example US';
  }
  if (has('registration_url')) {
    if (!input.registration_url) value.registration_url = null;
    else if (isHttpUrl(input.registration_url, { httpsOnly: true })) value.registration_url = input.registration_url.trim();
    else errors.registration_url = 'Registration link must start with https://';
  }
  if (has('registration_deadline')) {
    if (!input.registration_deadline) value.registration_deadline = null;
    else if (isRealDate(input.registration_deadline)) value.registration_deadline = input.registration_deadline;
    else errors.registration_deadline = 'Deadline must be a real date, YYYY-MM-DD';
  }
  for (const [field, max] of [['organizer_name', 200], ['venue_name', 200], ['address', 300]]) {
    if (has(field)) {
      const v = text(input[field], max);
      if (v === undefined) errors[field] = `At most ${max} characters`;
      else value[field] = v;
    }
  }
  for (const flag of ['gi', 'nogi', 'kids']) {
    if (has(flag)) value[flag] = input[flag] === true || input[flag] === 1 || input[flag] === '1' ? 1 : 0;
  }
  if (!partial) {
    if (isHttpUrl(input.source_url)) value.source_url = input.source_url.trim();
    else errors.source_url = 'Source link is required and must start with https:// or http://';
  }
  if (value.start_date && value.end_date && value.end_date < value.start_date) {
    errors.end_date = 'End date cannot be before the start date';
  }
  return { ok: Object.keys(errors).length === 0, errors, value };
}

// Chip colour for one field from its verification signals.
//   green: the latest check found this exact value on the source page
//   amber: the latest check did NOT confirm it
//   grey:  never checked, or edited since the check
export function chipFor(field, event, signals) {
  if (field === 'registration_url') {
    if (!event.registration_url) return 'amber';
    // A structurally-checked link is NOT a live one and must never render
    // as one (founder ruling, 2026-09-20 -- the fail-closed law). The host
    // refuses us, so all that was confirmed is that the URL is well-formed,
    // https and on an approved alias. Its own chip colour says so, and it
    // is not green, so a row carrying one can never be approved with a
    // plain A -- it needs the deliberate Shift+A.
    if (event.link_check_method === 'structural') return 'structural';
    const live = latest(signals, (s) => s.signal === 'link_live' && s.evidence?.url === event.registration_url);
    if (!live) return 'grey';
    return live.passed === 1 ? 'green' : 'amber';
  }
  // A derived state was reverse-matched from coordinates, not read off the
  // page. Location is a critical field, so this keeps it out of plain-A
  // range while still showing the reviewer it is a real, recorded answer.
  if (field === 'location' && event.state_source === 'derived') return 'derived';
  const current = field === 'location' ? `${event.city}, ${event.state}, ${event.country}` : event[field];
  const check = latest(signals, (s) => s.signal === 'grounding' && s.evidence?.field === field);
  if (!check) return 'grey';
  if (check.evidence && 'value' in check.evidence && String(check.evidence.value) !== String(current)) return 'grey';
  return check.passed === 1 ? 'green' : 'amber';
}

function latest(signals, predicate) {
  let best = null;
  for (const s of signals) if (predicate(s) && (!best || s.id > best.id)) best = s;
  return best;
}

export function chipsFor(event, signals) {
  const fields = ['name', 'start_date', 'end_date', 'location', 'venue_name', 'registration_url', 'registration_deadline', 'organizer_name'];
  return Object.fromEntries(fields.map((f) => [f, chipFor(f, event, signals)]));
}

// Candidates count as a possible duplicate unless the reviewer marked this row
// distinct from every one of them.
export function duplicateState(event, candidates, signals) {
  const similar = candidates.filter(
    (c) => nameSimilarity(c.name, event.name) >= 0.5 || normalizeText(c.city) === normalizeText(event.city),
  );
  const resolution = latest(signals, (s) => s.signal === 'duplicate_score' && s.passed === 1 && s.evidence?.resolved === 'distinct');
  const cleared = new Set(resolution?.evidence?.candidate_ids ?? []);
  const unresolved = similar.filter((c) => !cleared.has(c.id));
  return { candidates: similar, unresolved };
}

export const WEAKER_CHIPS = { structural: 'Structural', derived: 'Derived' };

// A plain A is allowed only when every critical field is green and no
// duplicate is unresolved. Everything else needs the deliberate Shift+A.
const FIELD_LABELS = { name: 'Name', start_date: 'Date', location: 'Location', registration_url: 'Registration link' };
const CHIP_WORDS = { amber: 'not confirmed', grey: 'not checked', structural: 'link not verified live (host refuses us)', derived: 'state derived from coordinates, not stated on the page' };

// Hard blockers: things the database will refuse outright, whatever the
// reviewer presses. Each names the field, the rule, and the way out.
export function approvalBlockers(event) {
  const blockers = [];
  if (!event.registration_url) {
    blockers.push({
      field: 'registration_url',
      message: 'This event has no registration link, and an approved event must have one (https).',
      fix: 'Press E to add the link, or R then 4 to reject it as a bad link.',
    });
  }
  return blockers;
}

export function approvalEligibility(chips, duplicates, event = null) {
  const blockers = event ? approvalBlockers(event) : [];
  const reasons = [];
  for (const f of CRITICAL_FIELDS) {
    if (chips[f] !== 'green') reasons.push(`${FIELD_LABELS[f]} ${CHIP_WORDS[chips[f]] ?? 'not checked'}`);
  }
  if (duplicates.unresolved.length > 0) reasons.push('Possible duplicate not resolved');
  return { plain: reasons.length === 0 && blockers.length === 0, reasons, blockers };
}

export function weekdayDate(isoDate) {
  if (!isRealDate(isoDate)) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function daysUntil(isoDate, today) {
  if (!isRealDate(isoDate) || !isRealDate(today)) return null;
  return Math.round((Date.parse(`${isoDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}

// Scout precision (ARCHITECTURE.md: "a first-week precision report per
// host"): of the scout-created rows a human has decided, how many did the
// human approve. `rows` = [{ source_host, decision: 'approved'|'rejected', n }].
// precision is null (never 0, never 1) until at least one decision exists,
// so an empty host cannot read as a perfect or a failing one.
export function precisionByHost(rows) {
  const hosts = new Map();
  for (const r of rows ?? []) {
    if (!hosts.has(r.source_host)) hosts.set(r.source_host, { host: r.source_host, approved: 0, rejected: 0 });
    const h = hosts.get(r.source_host);
    if (r.decision === 'approved') h.approved += r.n;
    else if (r.decision === 'rejected') h.rejected += r.n;
  }
  return [...hosts.values()]
    .map((h) => ({ ...h, decided: h.approved + h.rejected, precision: h.approved + h.rejected === 0 ? null : h.approved / (h.approved + h.rejected) }))
    .sort((a, b) => a.host.localeCompare(b.host));
}
