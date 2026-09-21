// ALMANAC console client. Keyboard first. All data is rendered with
// textContent (never innerHTML), so no source text can become markup.

const state = {
  session: null,
  overview: null,
  index: 0,
  detail: null,
  mode: 'loading', // loading | blocked | queue | edit | reject | undo | add | merge | help
  sourceWin: null,
  busy: false,
  decisions: [],
};

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const REQUEST_TIMEOUT_MS = 15000;

async function api(path, { method = 'GET', body } = {}) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: method === 'POST' ? { 'Content-Type': 'application/json', 'X-Almanac-Request': '1' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      signal: abort.signal,
    });
  } catch (err) {
    throw Object.assign(new Error(abort.signal.aborted
      ? 'No answer in 15 seconds. Nothing was saved. Check the terminal running the console, then try again.'
      : `The console could not reach the server: ${err.message}. Nothing was saved.`), { status: 0, data: {} });
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, data });
  return data;
}

let toastTimer;
function toast(message, warn = false) {
  const t = $('toast');
  t.textContent = message;
  t.className = warn ? 'toast warn' : 'toast';
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, warn ? 6000 : 3500);
}

// ---------- rendering ----------

function renderBadge() {
  const b = $('badge');
  const env = state.session?.environment;
  if (!env) { b.textContent = 'NOT SIGNED IN'; b.className = 'badge badge-unknown'; return; }
  if (!env.match) {
    b.textContent = `ENVIRONMENT MISMATCH (database: ${env.database ?? 'no marker'})`;
    b.className = 'badge badge-mismatch';
    return;
  }
  b.textContent = env.database.toUpperCase();
  b.className = `badge badge-${env.database}`;
  $('who').textContent = `${state.session.email}${state.session.via === 'dev' ? ' (local dev identity)' : ''}`;
}

function renderStrip() {
  const s = state.overview?.strip;
  const strip = $('strip');
  strip.replaceChildren();
  if (!s) return;
  const item = (label, value) => el('span', {}, `${label} `, el('b', {}, String(value)));
  const run = s.last_scout_run
    ? `${s.last_scout_run.component} ${s.last_scout_run.status} at ${s.last_scout_run.started_at.slice(0, 16).replace('T', ' ')} UTC`
    : 'none yet';
  strip.append(
    item('Needs review', s.needs_review),
    item('Approved and upcoming', s.approved_upcoming),
    item('Stale', s.stale),
    item('Rejected this week', s.rejected_this_week),
    item('Last scout run', run),
    el('span', {}, state.session.publish_connected ? 'Publishing connected' : 'Publishing not connected: approved rows stay in ALMANAC'),
  );
}

function legend(keys) {
  $('legend').replaceChildren(...keys.map(([k, label]) => el('span', {}, el('kbd', {}, k), ` ${label}`)));
}

function currentRow() {
  return state.overview?.queue.rows[state.index] ?? null;
}

function renderMain() {
  const main = $('main');
  main.replaceChildren();
  if (state.mode === 'blocked') return;
  const rows = state.overview.queue.rows;
  main.append(el('h1', { class: 'headline', 'data-testid': 'headline' }, state.overview.queue.headline));
  const precision = state.overview.precision ?? [];
  main.append(el('div', { class: 'precision', 'data-testid': 'precision' },
    el('span', {}, 'Scout precision: '),
    precision.length === 0
      ? el('span', {}, 'no scout rows reviewed yet')
      : el('span', {}, precision.map((p) => `${p.host} ${p.approved} of ${p.decided} approved (${Math.round(p.precision * 100)}%)`).join(' · ')),
  ));
  if (rows.length === 0) {
    main.append(el('div', { class: 'empty', 'data-testid': 'empty' },
      el('p', {}, state.overview.strip.last_scout_run ? 'The queue is clear.' : 'No scouts running yet.'),
      el('button', { class: 'primary', onclick: openAdd }, 'Add event ', el('kbd', {}, 'N')),
    ));
    legend([['N', 'add event'], ['U', 'undo'], ['?', 'help']]);
    return;
  }
  if (!state.detail) return;
  const { event, chips, duplicates, eligibility, display, signals } = state.detail;
  const editing = state.mode === 'edit';

  const card = el('div', { class: 'card', 'data-testid': 'row' });
  // A row built from a listing page, never from the event page itself, is
  // thinner than a detail-sourced one and says so on its face.
  if (event.link_check_method === 'structural' || event.state_source === 'derived') {
    card.append(el('div', { class: 'provenance', 'data-testid': 'provenance' },
      'Listing-sourced row: built from the organizer\u2019s event calendar, not the event page (that page refuses us). '
      + 'Divisions unknown. '
      + (event.state_source === 'derived' ? 'State derived from the event\u2019s coordinates. ' : '')
      + (event.link_check_method === 'structural' ? 'The registration link was checked for shape only, never opened.' : '')));
  }
  card.append(el('div', { class: 'position', 'data-testid': 'position' },
    `Row ${state.index + 1} of ${rows.length} · ${event.source_host} · Tier ${event.source_tier} · entered ${ago(event.created_at)}`));
  card.append(el('div', { class: 'source' },
    el('span', {}, 'Source'),
    el('span', { class: 'url' }, event.source_url),
    el('span', {}, 'press ', el('kbd', {}, 'O'), ' to open it in the source window'),
  ));

  const grid = el('div', { class: 'fields' });
  // Each chip colour has its OWN words. A structural link check and a
  // derived state are deliberately not phrased like "found on page": they
  // are weaker facts, and a reviewer has to be able to see that at a
  // glance (founder ruling, 2026-09-20).
  const CHIP_LABELS = {
    green: 'found on page',
    amber: 'not confirmed',
    grey: 'not checked',
    structural: 'link not checked live',
    derived: 'state derived from map',
  };
  const chip = (name) => {
    const c = chips[name] ?? 'grey';
    return el('span', { class: `chip chip-${c}`, 'data-chip': name, 'data-color': c }, CHIP_LABELS[c] ?? 'not checked');
  };
  const row = (label, valueNode, chipNode) => grid.append(el('span', { class: 'label' }, label), el('span', { class: 'value' }, valueNode), chipNode ?? el('span'));
  const input = (field, type = 'text') => el('input', { name: field, type, value: event[field] ?? '', 'data-field': field });

  if (editing) {
    const select = el('select', { name: 'event_type', 'data-field': 'event_type' },
      ...['tournament', 'superfight', 'seminar', 'camp', 'open_competition'].map((t) => el('option', { value: t, selected: t === event.event_type }, t.replace('_', ' '))));
    row('Event type', select);
    row('Name', input('name'), chip('name'));
    row('Start date', input('start_date', 'date'), chip('start_date'));
    row('End date', input('end_date', 'date'), chip('end_date'));
    row('Venue', input('venue_name'), chip('venue_name'));
    row('Address', input('address'));
    row('City', input('city'), chip('location'));
    row('State', input('state'));
    row('Country', input('country'));
    row('Registration link', input('registration_url', 'url'), chip('registration_url'));
    row('Deadline', input('registration_deadline', 'date'), chip('registration_deadline'));
    row('Divisions', el('span', { class: 'flags' },
      ...['gi', 'nogi', 'kids'].map((f) => el('label', {}, el('input', { type: 'checkbox', 'data-field': f, checked: event[f] === 1 }), ` ${f} `))));
    row('Organizer', input('organizer_name'), chip('organizer_name'));
  } else {
    row('Event type', event.event_type.replace('_', ' '));
    row('Name', event.name, chip('name'));
    row('Date', `${display.start}${display.days_until !== null ? ` · in ${display.days_until} days` : ''}`, chip('start_date'));
    if (event.end_date) row('End date', display.end, chip('end_date'));
    row('Venue', [event.venue_name, event.address].filter(Boolean).join(', ') || 'not given', chip('venue_name'));
    row('Location', `${event.city}, ${event.state}, ${event.country}${signals.geocode_confidence !== null ? ` · geocoded ${signals.geocode_confidence}/10` : ' · not geocoded'}`, chip('location'));
    const live = signals.link_live;
    row('Registration link', event.registration_url
      ? `${event.registration_url}${live ? ` · ${live.passed === 1 ? 'live' : 'NOT live'} ${ago(live.checked_at)}` : ' · link not checked'}`
      : 'none', chip('registration_url'));
    row('Deadline', event.registration_deadline || 'not given', chip('registration_deadline'));
    row('Divisions', el('span', { class: 'flags' }, ...['gi', 'nogi', 'kids'].map((f) => el('span', {}, `${event[f] ? '✓' : '✗'} ${f}`))));
    row('Organizer', event.organizer_name || 'not given', chip('organizer_name'));
  }
  card.append(grid);

  if (duplicates.unresolved.length > 0) {
    card.append(el('div', { class: 'dupes dupes-open', 'data-testid': 'dupes' },
      `${duplicates.unresolved.length} possible duplicate${duplicates.unresolved.length > 1 ? 's' : ''}: `,
      duplicates.unresolved.map((c) => `${c.name} (${c.start_date}, ${c.city}, ${c.status})`).join('; '),
      ' · press ', el('kbd', {}, 'M'), ' merge or ', el('kbd', {}, 'D'), ' distinct'));
  } else {
    card.append(el('div', { class: 'dupes dupes-none', 'data-testid': 'dupes' }, 'No possible duplicates'));
  }

  if (editing) {
    card.append(el('div', { class: 'editbar', 'data-testid': 'editbar' },
      el('button', { class: 'primary', 'data-testid': 'save-edit', onclick: saveEdit }, 'Save changes'),
      el('button', { 'data-testid': 'cancel-edit', onclick: cancelEdit }, 'Cancel'),
      el('span', { class: 'hint' }, 'Enter saves from any field. Esc cancels.'),
    ));
  }
  if (!editing && eligibility.blockers?.length) {
    const b = eligibility.blockers[0];
    card.append(el('div', { class: 'gate gate-blocked', 'data-testid': 'gate' }, `${b.message} ${b.fix}`));
  } else if (!editing) {
    card.append(eligibility.plain
      ? el('div', { class: 'gate gate-plain', 'data-testid': 'gate' }, 'Every critical field is confirmed: ', el('kbd', {}, 'A'), ' approves.')
      : el('div', { class: 'gate gate-deliberate', 'data-testid': 'gate' },
        'Deliberate approval required: ', el('kbd', {}, 'Shift'), '+', el('kbd', {}, 'A'), `. ${eligibility.reasons.join('; ')}.`));
  }
  main.append(card);

  legend(editing
    ? [['Enter', 'save'], ['Esc', 'cancel']]
    : [['A', 'approve'], ['Shift+A', 'deliberate approve'], ['R', 'reject'], ['E', 'edit'], ['S', 'skip'], ['J/K', 'next/prev'], ['O', 'source'], ['F', 'copy unconfirmed'], ['U', 'undo'], ['N', 'add'], ['?', 'help']]);

  if (editing) {
    const first = grid.querySelector('input[data-field="start_date"]');
    const amberField = Object.entries(chips).find(([, c]) => c !== 'green')?.[0];
    const target = grid.querySelector(`[data-field="${amberField === 'location' ? 'city' : amberField}"]`) ?? first;
    target?.focus();
  }
}

function ago(iso) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

// ---------- overlays ----------

function showOverlay(mode, panel) {
  state.mode = mode;
  const o = $('overlay');
  o.replaceChildren(panel);
  o.hidden = false;
}

function closeOverlay() {
  $('overlay').hidden = true;
  $('overlay').replaceChildren();
  state.mode = 'queue';
}

function openReject() {
  const reasons = state.session.reject_reasons;
  showOverlay('reject', el('div', { class: 'panel', 'data-testid': 'reject-panel' },
    el('h2', {}, 'Reject: press a number'),
    el('ol', {}, ...Object.entries(reasons).map(([n, r]) => el('li', {}, el('kbd', {}, n), ` ${r.label}`))),
    el('p', {}, el('kbd', {}, 'Esc'), ' cancel'),
  ));
}

async function openUndo() {
  try {
    state.decisions = (await api('/api/decisions/recent')).decisions;
  } catch (e) { toast(e.message, true); return; }
  showOverlay('undo', el('div', { class: 'panel', 'data-testid': 'undo-panel' },
    el('h2', {}, 'Undo: your last five decisions'),
    state.decisions.length === 0
      ? el('p', {}, 'No decisions yet.')
      : el('ol', {}, ...state.decisions.map((d, i) => el('li', { class: d.undoable ? '' : 'disabled' },
        el('kbd', {}, String(i + 1)), ` ${d.decision}${d.reason ? ` (${d.reason})` : ''}: ${d.name} · ${ago(d.at)}${d.undoable ? '' : ' · moved on since, open it instead'}`))),
    el('p', {}, 'Undo returns the row to the queue. ', el('kbd', {}, 'Esc'), ' cancel'),
  ));
}

function openMerge() {
  const c = state.detail.duplicates.unresolved;
  if (c.length === 0) { toast('No possible duplicate to merge into', true); return; }
  if (c.length === 1) { merge(c[0].id); return; }
  showOverlay('merge', el('div', { class: 'panel' },
    el('h2', {}, 'Merge into which row? Press a number'),
    el('ol', {}, ...c.slice(0, 9).map((d, i) => el('li', {}, el('kbd', {}, String(i + 1)), ` ${d.name} · ${d.start_date} · ${d.city} · ${d.status}`))),
    el('p', {}, el('kbd', {}, 'Esc'), ' cancel'),
  ));
}

function openHelp() {
  showOverlay('help', el('div', { class: 'panel' },
    el('h2', {}, 'Keys'),
    el('ol', {}, ...[
      ['A', 'Approve. Works only when name, date, location and registration link are all green and no duplicate is open.'],
      ['Shift+A', 'Deliberate approve, for rows with anything unconfirmed. Read the amber fields first.'],
      ['R then 1-6', 'Reject with a reason.'],
      ['E', 'Edit this row. Enter saves, Esc cancels.'],
      ['M / D', 'Merge into the possible duplicate, or mark it distinct.'],
      ['O', 'Open the source page in the source window. It follows you row to row.'],
      ['F', 'Copy the first unconfirmed value, then Cmd+F in the source window.'],
      ['J / K / S', 'Next, previous, skip to the end of the queue.'],
      ['U', 'Undo one of your last five decisions.'],
      ['N', 'Add an event by hand. It joins the queue for review.'],
    ].map(([k, t]) => el('li', {}, el('kbd', {}, k), ` ${t}`))),
    el('p', {}, el('kbd', {}, 'Esc'), ' close'),
  ));
}

function openAdd() {
  const field = (label, name, type = 'text', attrs = {}) => [
    el('label', { for: `add-${name}` }, label),
    el('input', { id: `add-${name}`, name, type, ...attrs }),
    el('span', { class: 'form-error', 'data-error': name }),
  ];
  const form = el('form', { class: 'panel', 'data-testid': 'add-form', onsubmit: submitAdd },
    el('h2', {}, 'Add an event (it joins the queue for review)'),
    el('div', { class: 'form-grid' },
      el('label', { for: 'add-event_type' }, 'Event type'),
      el('select', { id: 'add-event_type', name: 'event_type' },
        ...['tournament', 'superfight', 'seminar', 'camp', 'open_competition'].map((t) => el('option', { value: t }, t.replace('_', ' ')))),
      el('span', { class: 'form-error', 'data-error': 'event_type' }),
      ...field('Name', 'name', 'text', { required: true, maxlength: 200 }),
      ...field('Start date', 'start_date', 'date', { required: true }),
      ...field('End date', 'end_date', 'date'),
      ...field('Venue', 'venue_name'),
      ...field('Address', 'address'),
      ...field('City', 'city', 'text', { required: true }),
      ...field('State', 'state', 'text', { required: true, maxlength: 3, placeholder: 'MO' }),
      ...field('Country', 'country', 'text', { required: true, maxlength: 2, value: 'US' }),
      ...field('Registration link', 'registration_url', 'url', { placeholder: 'https://' }),
      el('span'),
      el('span', { class: 'hint' }, 'Needed before the event can be approved. You can save without it and add it later.'),
      el('span'),
      ...field('Deadline', 'registration_deadline', 'date'),
      el('span', {}, 'Divisions'),
      el('span', { class: 'checks' }, ...['gi', 'nogi', 'kids'].map((f) => el('label', {}, el('input', { type: 'checkbox', name: f }), f))),
      el('span', { class: 'form-error' }),
      ...field('Organizer', 'organizer_name'),
      ...field('Source page link', 'source_url', 'url', { required: true, placeholder: 'https://' }),
    ),
    el('p', {}, el('button', { class: 'primary', type: 'submit' }, 'Save to queue'), ' ', el('kbd', {}, 'Esc'), ' cancel'),
  );
  showOverlay('add', form);
  form.querySelector('#add-name').focus();
}

async function submitAdd(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const fd = new FormData(form);
  const body = Object.fromEntries([...fd.entries()].filter(([k]) => !['gi', 'nogi', 'kids'].includes(k)));
  for (const f of ['gi', 'nogi', 'kids']) body[f] = fd.has(f);
  form.querySelectorAll('[data-error]').forEach((n) => { n.textContent = ''; });
  try {
    const res = await api('/api/events', { method: 'POST', body });
    closeOverlay();
    toast(body.registration_url
      ? `Saved to the queue${res.geocoded ? '' : ' (not geocoded)'}`
      : 'Saved to the queue. It needs a registration link before it can be approved (press E).');
    await refresh(res.id);
  } catch (err) {
    if (err.data?.fields) {
      for (const [f, msg] of Object.entries(err.data.fields)) {
        const n = form.querySelector(`[data-error="${f}"]`);
        if (n) n.textContent = msg;
      }
    } else toast(err.message, true);
  }
}

// ---------- actions ----------

async function refresh(focusId) {
  state.overview = await api('/api/overview');
  const rows = state.overview.queue.rows;
  if (focusId) {
    const i = rows.findIndex((r) => r.id === focusId);
    if (i >= 0) state.index = i;
  }
  if (state.index >= rows.length) state.index = Math.max(0, rows.length - 1);
  state.detail = rows.length ? await api(`/api/events/${rows[state.index].id}`) : null;
  renderStrip();
  renderMain();
  followSource();
}

async function act(fn, successMessage) {
  if (state.busy) return;
  state.busy = true;
  try {
    await fn();
    if (successMessage) toast(successMessage);
    await refresh();
  } catch (err) {
    toast(err.data?.details?.reasons ? `${err.message}: ${err.data.details.reasons.join('; ')}` : err.message, true);
  } finally {
    state.busy = false;
  }
}

function approve(deliberate) {
  const row = currentRow();
  if (!row) return;
  if (state.busy) { toast('Still working on the last action...', true); return; }
  const blocker = state.detail.eligibility.blockers?.[0];
  if (blocker) { toast(`${blocker.message} ${blocker.fix}`, true); return; }
  if (!deliberate && !state.detail.eligibility.plain) {
    toast(`Not every critical field is confirmed. Read the amber fields, then Shift+A. (${state.detail.eligibility.reasons.join('; ')})`, true);
    return;
  }
  act(() => api(`/api/events/${row.id}/decision`, { method: 'POST', body: { decision: 'approve', deliberate } }), 'Approved · U to undo');
}

function reject(n) {
  const row = currentRow();
  closeOverlay();
  act(() => api(`/api/events/${row.id}/decision`, { method: 'POST', body: { decision: 'reject', reason: n } }), 'Rejected · U to undo');
}

function undo(i) {
  const d = state.decisions[i];
  closeOverlay();
  if (!d) return;
  act(() => api('/api/decisions/undo', { method: 'POST', body: { log_id: d.log_id } }), `Undone: ${d.name} is back in the queue`);
}

function merge(intoId) {
  const row = currentRow();
  closeOverlay();
  act(() => api(`/api/events/${row.id}/duplicate`, { method: 'POST', body: { action: 'merge', into: intoId } }), 'Merged as a duplicate · U to undo');
}

function distinct() {
  const row = currentRow();
  if (!row || state.detail.duplicates.unresolved.length === 0) { toast('No possible duplicate to clear', true); return; }
  act(() => api(`/api/events/${row.id}/duplicate`, { method: 'POST', body: { action: 'distinct' } }), 'Marked distinct');
}

// What the reviewer has typed, compared with what the row holds.
function editedFields() {
  const event = state.detail?.event;
  if (!event) return [];
  const changed = [];
  document.querySelectorAll('#main [data-field]').forEach((n) => {
    const now = n.type === 'checkbox' ? (n.checked ? 1 : 0) : n.value;
    const before = n.type === 'checkbox' ? (event[n.dataset.field] ?? 0) : (event[n.dataset.field] ?? '');
    if (String(now) !== String(before)) changed.push(n.dataset.field);
  });
  return changed;
}

// Closing the warning panel returns to edit mode WITHOUT re-rendering, so
// everything typed is still on screen.
function keepEditing() {
  closeOverlay();
  state.mode = 'edit';
}

function discardEdit() {
  closeOverlay();
  state.mode = 'queue';
  renderMain();
  toast('Changes discarded');
}

// Esc never throws typing away without asking.
function cancelEdit() {
  const changed = editedFields();
  if (changed.length === 0) { state.mode = 'queue'; renderMain(); return; }
  showOverlay('discard', el('div', { class: 'panel', 'data-testid': 'discard-panel' },
    el('h2', {}, 'Unsaved changes'),
    el('p', {}, `You changed: ${changed.join(', ')}.`),
    el('ol', {},
      el('li', {}, el('kbd', {}, 'S'), ' save the changes'),
      el('li', {}, el('kbd', {}, 'D'), ' discard them'),
      el('li', {}, el('kbd', {}, 'Esc'), ' keep editing')),
    el('p', {},
      el('button', { class: 'primary', onclick: () => { keepEditing(); saveEdit(); } }, 'Save changes'), ' ',
      el('button', { 'data-testid': 'discard-confirm', onclick: discardEdit }, 'Discard')),
  ));
}

async function saveEdit() {
  const row = currentRow();
  const body = {};
  document.querySelectorAll('#main [data-field]').forEach((n) => {
    body[n.dataset.field] = n.type === 'checkbox' ? n.checked : n.value;
  });
  if (state.busy) { toast('Still saving the last change...', true); return; }
  state.busy = true;
  const saveButton = document.querySelector('[data-testid="save-edit"]');
  if (saveButton) { saveButton.textContent = 'Saving...'; saveButton.disabled = true; }
  try {
    const res = await api(`/api/events/${row.id}/edit`, { method: 'POST', body });
    state.mode = 'queue';
    toast(res.changed.length ? `Saved: ${res.changed.join(', ')}` : 'No changes');
    await refresh(row.id);
  } catch (err) {
    // Stay in edit mode so nothing typed is lost.
    const fields = err.data?.fields ? Object.values(err.data.fields).join('; ') : '';
    toast(fields ? `${err.message}: ${fields}` : err.message, true);
  } finally {
    state.busy = false;
    const button = document.querySelector('[data-testid="save-edit"]');
    if (button) { button.textContent = 'Save changes'; button.disabled = false; }
  }
}

// The source window keeps its opener link: without it, the browser refuses to
// let the console move that window row to row. The cost is that a hostile
// source page could try to navigate the console tab away (reverse tabnabbing).
// Guard: while a source window is open, any navigation away from the console
// raises the browser's own "Leave site?" dialog, so it cannot happen silently.
function openSource() {
  const row = state.detail?.event;
  if (!row) return;
  const w = window.open(row.source_url, 'almanac-source');
  if (!w) { toast('Allow pop-ups for the console so the source window can open', true); return; }
  state.sourceWin = w;
}

function followSource() {
  if (!state.sourceWin || state.sourceWin.closed || !state.detail) return;
  state.sourceWin.location.href = state.detail.event.source_url;
}

window.addEventListener('beforeunload', (event) => {
  if (state.sourceWin && !state.sourceWin.closed) {
    event.preventDefault();
    event.returnValue = '';
  }
});

async function copyUnconfirmed() {
  const { event, chips } = state.detail ?? {};
  if (!event) return;
  const field = Object.entries(chips).find(([f, c]) => c === 'amber' && f !== 'registration_url')?.[0]
    ?? Object.entries(chips).find(([, c]) => c !== 'green')?.[0];
  if (!field) { toast('Every field is confirmed'); return; }
  const value = field === 'location' ? event.city : field === 'start_date' ? state.detail.display.start : event[field];
  if (!value) { toast('That field is empty', true); return; }
  try {
    await navigator.clipboard.writeText(String(value));
    toast(`Copied "${value}". Press Cmd+F in the source window, then Cmd+V.`);
  } catch { toast('Clipboard not available', true); }
}

function move(delta) {
  const rows = state.overview.queue.rows;
  if (rows.length === 0) return;
  state.index = (state.index + delta + rows.length) % rows.length;
  refreshDetail();
}

function skip() {
  const rows = state.overview.queue.rows;
  if (rows.length < 2) return;
  const [r] = rows.splice(state.index, 1);
  rows.push(r);
  if (state.index >= rows.length) state.index = 0;
  refreshDetail();
  toast('Skipped to the end of the queue');
}

async function refreshDetail() {
  const row = currentRow();
  state.detail = row ? await api(`/api/events/${row.id}`) : null;
  renderMain();
  followSource();
}

// ---------- keyboard ----------

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const inField = ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName);

  if (e.key === 'Escape') {
    if (state.mode === 'discard') keepEditing();   // back to editing, typing intact
    else if (state.mode === 'edit') cancelEdit();
    else if (!$('overlay').hidden) closeOverlay();
    e.preventDefault();
    return;
  }
  if (state.mode === 'discard') {
    const k = e.key.toLowerCase();
    if (k === 's') { keepEditing(); saveEdit(); }
    if (k === 'd') discardEdit();
    e.preventDefault();
    return;
  }
  if (state.mode === 'edit') {
    if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
    return;
  }
  if (state.mode === 'add') return; // the form handles its own keys
  if (inField) return;

  if (state.mode === 'reject') { if (/^[1-6]$/.test(e.key)) reject(Number(e.key)); e.preventDefault(); return; }
  if (state.mode === 'undo') { if (/^[1-5]$/.test(e.key)) undo(Number(e.key) - 1); e.preventDefault(); return; }
  if (state.mode === 'merge') {
    const i = Number(e.key) - 1;
    if (/^[1-9]$/.test(e.key) && state.detail.duplicates.unresolved[i]) merge(state.detail.duplicates.unresolved[i].id);
    e.preventDefault();
    return;
  }
  if (state.mode === 'help') { if (e.key === '?') closeOverlay(); return; }
  if (state.mode !== 'queue') return;

  const hasRow = Boolean(currentRow() && state.detail);
  // Lowercase the key so Caps Lock can never turn A into a deliberate approval;
  // only a held Shift key does that.
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const handlers = {
    a: () => hasRow && approve(e.shiftKey),
    r: () => hasRow && openReject(),
    e: () => { if (hasRow) { state.mode = 'edit'; renderMain(); } },
    s: () => hasRow && skip(),
    j: () => move(1),
    k: () => move(-1),
    o: () => hasRow && openSource(),
    f: () => hasRow && copyUnconfirmed(),
    m: () => hasRow && openMerge(),
    d: () => hasRow && distinct(),
    u: () => openUndo(),
    n: () => openAdd(),
    '?': () => openHelp(),
  };
  const h = handlers[key];
  if (h) { e.preventDefault(); h(); }
});

// ---------- start ----------

async function init() {
  try {
    state.session = await api('/api/session');
  } catch (err) {
    state.mode = 'blocked';
    $('badge').textContent = err.status === 401 ? 'NOT SIGNED IN' : 'ERROR';
    $('main').replaceChildren(el('div', { class: 'empty' }, el('p', {}, err.status === 401 ? 'Sign in through Cloudflare Access to use the console.' : err.message)));
    return;
  }
  renderBadge();
  if (!state.session.reviewer?.active) {
    state.mode = 'blocked';
    $('main').replaceChildren(el('div', { class: 'empty', 'data-testid': 'not-reviewer' },
      el('p', {}, `${state.session.email} is not an active reviewer in this database.`),
      el('p', {}, 'Add the reviewers row for this exact email, then reload.')));
    return;
  }
  state.mode = 'queue';
  await refresh();
}

init();
