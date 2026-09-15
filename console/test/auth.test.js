import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveIdentity, verifyAccessJwt, devIdentityAllowed } from '../src/auth.js';

const TEAM = 'jiujitsuoutlet.cloudflareaccess.com';
const AUD = 'test-aud-tag';

function b64url(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function makeSigner() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', publicKey);
  const jwks = { keys: [{ ...jwk, kid: 'k1', alg: 'RS256', use: 'sig' }] };
  const sign = async (payload, header = { alg: 'RS256', kid: 'k1', typ: 'JWT' }) => {
    const h = b64url(Buffer.from(JSON.stringify(header)));
    const p = b64url(Buffer.from(JSON.stringify(payload)));
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${h}.${p}`));
    return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
  };
  return { jwks, sign };
}

const now = Date.parse('2026-09-15T12:00:00Z');
const s = Math.floor(now / 1000);
const good = { aud: [AUD], iss: `https://${TEAM}`, email: 'Reviewer@Example.com', exp: s + 3600, nbf: s - 10 };

test('valid Access token is accepted and the email is lowercased', async () => {
  const { jwks, sign } = await makeSigner();
  const token = await sign(good);
  const payload = await verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD, now, fetchJwks: async () => jwks });
  assert.equal(payload.email, 'Reviewer@Example.com');
  const req = new Request('https://almanac-console.example.workers.dev/api/session', { headers: { 'Cf-Access-Jwt-Assertion': token } });
  const id = await resolveIdentity(req, { ENVIRONMENT: 'production', ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD }, { now, fetchJwks: async () => jwks });
  assert.deepEqual(id, { email: 'reviewer@example.com', via: 'access' });
});

test('Access tokens are refused when wrong in any way', async () => {
  const { jwks, sign } = await makeSigner();
  const other = await makeSigner();
  const opts = { teamDomain: TEAM, aud: AUD, now, fetchJwks: async () => jwks };
  await assert.rejects(verifyAccessJwt(await sign({ ...good, aud: ['other'] }), opts), /wrong audience/);
  await assert.rejects(verifyAccessJwt(await sign({ ...good, iss: 'https://evil.cloudflareaccess.com' }), opts), /wrong issuer/);
  await assert.rejects(verifyAccessJwt(await sign({ ...good, exp: s - 1 }), opts), /expired/);
  await assert.rejects(verifyAccessJwt(await other.sign(good), opts), /bad signature/);
  await assert.rejects(verifyAccessJwt(await sign(good, { alg: 'none', kid: 'k1' }), opts), /unsupported/);
  await assert.rejects(verifyAccessJwt('not.a.token', opts));
});

test('production with no ACCESS_AUD refuses even a well-signed token', async () => {
  const { jwks, sign } = await makeSigner();
  const req = new Request('https://x.workers.dev/api/session', { headers: { 'Cf-Access-Jwt-Assertion': await sign(good) } });
  assert.equal(await resolveIdentity(req, { ENVIRONMENT: 'production', ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: '' }, { now, fetchJwks: async () => jwks }), null);
});

test('dev identity: only staging, only when allowed, only on localhost', async () => {
  const dev = { ENVIRONMENT: 'staging', ALLOW_DEV_IDENTITY: 'true', DEV_ACCESS_EMAIL: 'me@example.com' };
  const local = new Request('http://localhost:8788/api/session');
  assert.equal(devIdentityAllowed(local, dev), true);
  assert.deepEqual(await resolveIdentity(local, dev), { email: 'me@example.com', via: 'dev' });

  assert.equal(await resolveIdentity(local, { ...dev, ENVIRONMENT: 'production' }), null, 'production never accepts the dev identity');
  assert.equal(await resolveIdentity(local, { ...dev, ALLOW_DEV_IDENTITY: 'false' }), null);
  assert.equal(await resolveIdentity(local, { ...dev, ALLOW_DEV_IDENTITY: undefined }), null);
  assert.equal(await resolveIdentity(new Request('https://almanac-console-staging.example.workers.dev/api/session'), dev), null, 'deployed hosts never accept it');
  assert.equal(await resolveIdentity(local, { ...dev, DEV_ACCESS_EMAIL: '' }), null);
});
