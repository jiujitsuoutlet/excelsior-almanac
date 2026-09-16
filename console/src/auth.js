// Identity for the ALMANAC console.
//
// Production and deployed staging: Cloudflare Access sits in front of the
// Worker and forwards a signed JWT in the Cf-Access-Jwt-Assertion header. The
// Worker verifies its RS256 signature against the team's published keys, and
// checks issuer, audience, expiry and not-before. No valid token, no identity.
//
// Local development only: when ENVIRONMENT is "staging", ALLOW_DEV_IDENTITY is
// "true" (set only in the gitignored console/.dev.vars) and the request is to
// localhost, DEV_ACCESS_EMAIL stands in for the Access identity. Production
// never accepts it, whatever its settings say.

const JWKS_TTL_MS = 10 * 60 * 1000;
const jwksCache = new Map();

export async function resolveIdentity(request, env, { fetchJwks = defaultFetchJwks, now = Date.now() } = {}) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (token) {
    if (!env.ACCESS_AUD || !env.ACCESS_TEAM_DOMAIN) return null;
    try {
      const payload = await verifyAccessJwt(token, {
        teamDomain: env.ACCESS_TEAM_DOMAIN,
        aud: env.ACCESS_AUD,
        now,
        fetchJwks,
      });
      if (typeof payload.email !== 'string' || !payload.email.includes('@')) return null;
      return { email: payload.email.toLowerCase(), via: 'access' };
    } catch {
      return null;
    }
  }
  if (devIdentityAllowed(request, env)) {
    return { email: String(env.DEV_ACCESS_EMAIL).toLowerCase(), via: 'dev' };
  }
  return null;
}

export function devIdentityAllowed(request, env) {
  if (env.ENVIRONMENT !== 'staging') return false;
  if (env.ALLOW_DEV_IDENTITY !== 'true') return false;
  if (!env.DEV_ACCESS_EMAIL || !String(env.DEV_ACCESS_EMAIL).includes('@')) return false;
  const host = new URL(request.url).hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

export async function verifyAccessJwt(token, { teamDomain, aud, now = Date.now(), fetchJwks = defaultFetchJwks }) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [h, p, s] = parts;
  const header = JSON.parse(utf8(base64UrlDecode(h)));
  const payload = JSON.parse(utf8(base64UrlDecode(p)));
  if (header.alg !== 'RS256' || !header.kid) throw new Error('unsupported token');

  const jwks = await fetchJwks(teamDomain);
  const jwk = (jwks.keys || []).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown signing key');
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlDecode(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) throw new Error('bad signature');

  const seconds = Math.floor(now / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(aud)) throw new Error('wrong audience');
  if (payload.iss !== `https://${teamDomain}`) throw new Error('wrong issuer');
  if (typeof payload.exp !== 'number' || payload.exp <= seconds) throw new Error('expired');
  if (typeof payload.nbf === 'number' && payload.nbf > seconds + 60) throw new Error('not yet valid');
  return payload;
}

async function defaultFetchJwks(teamDomain) {
  const cached = jwksCache.get(teamDomain);
  if (cached && cached.expires > Date.now()) return cached.jwks;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error('could not fetch Access keys');
  const jwks = await res.json();
  jwksCache.set(teamDomain, { jwks, expires: Date.now() + JWKS_TTL_MS });
  return jwks;
}

export function base64UrlDecode(input) {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function utf8(bytes) {
  return new TextDecoder().decode(bytes);
}
