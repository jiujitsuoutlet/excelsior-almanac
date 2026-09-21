// ALMANAC approval console Worker: a small JSON API plus static assets.
//
// Guards, in order, for every /api/ request:
//   1. identity (Cloudflare Access JWT, or the local-only dev identity)
//   2. an active row in reviewers (except /api/session, which reports status)
//   3. for writes: same-origin + X-Almanac-Request header (CSRF), and the
//      database's environment_marker must match this Worker's ENVIRONMENT

import { resolveIdentity } from './auth.js';
import {
  ConsoleError, getMarker, getReviewer, statusStrip, queue, rowDetail, decide,
  resolveDuplicate, editEvent, addEvent, recentDecisions, undoDecision, scoutPrecision,
} from './data.js';
import { validateEventInput, REJECT_REASONS } from './lib.js';
import { geocode } from './geocode.js';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    }
    try {
      return await handleApi(request, env, url);
    } catch (err) {
      if (err instanceof ConsoleError) return json(err.status, { error: err.message, ...(err.details ? { details: err.details } : {}) });
      console.error('console error', err);
      return json(500, { error: 'Internal error' });
    }
  },
};

async function handleApi(request, env, url) {
  const identity = await resolveIdentity(request, env);
  if (!identity) return json(401, { error: 'Not signed in' });

  const db = env.DB;
  const marker = await getMarker(db).catch(() => null);
  const environment = { configured: env.ENVIRONMENT, database: marker, match: marker !== null && marker === env.ENVIRONMENT };
  const reviewer = await getReviewer(db, identity.email);
  const path = url.pathname;
  const method = request.method;

  if (path === '/api/session' && method === 'GET') {
    return json(200, {
      email: identity.email,
      via: identity.via,
      reviewer: reviewer ? { role: reviewer.role, active: reviewer.active === 1 } : null,
      environment,
      publish_connected: env.PUBLISH_CONNECTED === 'true',
      reject_reasons: REJECT_REASONS,
    });
  }

  if (!reviewer || reviewer.active !== 1) return json(403, { error: 'Not an active reviewer' });

  if (method === 'POST') {
    const origin = request.headers.get('Origin');
    if (request.headers.get('X-Almanac-Request') !== '1' || (origin && origin !== url.origin)) {
      return json(403, { error: 'Request refused (cross-site protection)' });
    }
    if (!environment.match) {
      return json(409, { error: 'Environment mismatch: the database marker does not match this console', environment });
    }
  }

  const actor = identity.email;
  const body = method === 'POST' ? await readJson(request) : null;
  let m;

  if (path === '/api/overview' && method === 'GET') {
    return json(200, { strip: await statusStrip(db), queue: await queue(db), precision: await scoutPrecision(db) });
  }
  if ((m = path.match(/^\/api\/events\/([0-9a-zA-Z-]+)$/)) && method === 'GET') {
    return json(200, await rowDetail(db, m[1]));
  }
  if (path === '/api/events' && method === 'POST') {
    const { ok, errors, value } = validateEventInput(body);
    if (!ok) return json(400, { error: 'Some fields need fixing', fields: errors });
    const coords = await geocode(value, env).catch(() => null);
    return json(201, await addEvent(db, value, actor, coords));
  }
  if ((m = path.match(/^\/api\/events\/([0-9a-zA-Z-]+)\/decision$/)) && method === 'POST') {
    return json(200, await decide(db, m[1], body, actor));
  }
  if ((m = path.match(/^\/api\/events\/([0-9a-zA-Z-]+)\/duplicate$/)) && method === 'POST') {
    return json(200, await resolveDuplicate(db, m[1], body, actor));
  }
  if ((m = path.match(/^\/api\/events\/([0-9a-zA-Z-]+)\/edit$/)) && method === 'POST') {
    const { ok, errors, value } = validateEventInput(body, { partial: true });
    if (!ok) return json(400, { error: 'Some fields need fixing', fields: errors });
    return json(200, await editEvent(db, m[1], body, actor, value));
  }
  if (path === '/api/decisions/recent' && method === 'GET') {
    return json(200, { decisions: await recentDecisions(db, actor) });
  }
  if (path === '/api/decisions/undo' && method === 'POST') {
    return json(200, await undoDecision(db, Number(body?.log_id), actor));
  }
  return json(404, { error: 'Not found' });
}

async function readJson(request) {
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) {
    throw new ConsoleError(415, 'Send JSON');
  }
  try {
    return await request.json();
  } catch {
    throw new ConsoleError(400, 'Invalid JSON');
  }
}
