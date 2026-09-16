// HMAC-SHA256 signing of the canonical batch payload, using the Web Crypto
// API (available in the Workers runtime and in Node, so these functions test
// the same way they run). The app's `almanac-ingest` function verifies with
// the same secret and the same canonicalization (`payload.js`'s
// `canonicalize`)... a signature is only meaningful if both sides hash
// exactly the same bytes.

async function importKey(secret) {
  if (!secret) throw new Error('sign/verify requires a non-empty secret');
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

// Signs the canonical string form of the batch (not the batch object...
// callers pass whatever `canonicalize()` produced, so signing and
// verification never disagree about what was hashed).
export async function sign(canonicalPayload, secret) {
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonicalPayload));
  return toHex(signature);
}

// Verification is the app side's job (it lives in `jiujitsuoutlet/excelsior-
// master`, not this repository), but the function is exported from here too
// so both sides can be tested against the exact same implementation rather
// than two hand-written copies that could quietly drift apart... the same
// "one place reads the other" discipline as VERIFICATION.md's hand-copy law.
export async function verify(canonicalPayload, signatureHex, secret) {
  const signatureBytes = fromHex(signatureHex);
  if (!signatureBytes) return false;
  const key = await importKey(secret);
  return crypto.subtle.verify('HMAC', key, signatureBytes, new TextEncoder().encode(canonicalPayload));
}

// Replay law (ARCHITECTURE.md Hold 3: "must refuse a replayed call carrying
// an old timestamp"). A batch timestamp older than this window is refused
// regardless of a valid signature... a valid-but-stale signed batch is
// exactly what a captured-and-replayed request looks like.
export const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000;

export function isTimestampFresh(isoTimestamp, now = Date.now()) {
  const t = Date.parse(isoTimestamp);
  if (Number.isNaN(t)) return false;
  const age = now - t;
  return age >= 0 && age <= MAX_TIMESTAMP_AGE_MS;
}
