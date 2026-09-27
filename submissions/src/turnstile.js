// Cloudflare Turnstile verification. `fetchImpl` is injected (same DI
// seam as scout/src/linkcheck.js's fetchImpl/claimSlot pattern) so this
// is provable with a fake response, never a real network call in a test.
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * @returns {Promise<{ok: true} | {ok: false, reason: string}>}
 */
export async function verifyTurnstile(token, secretKey, remoteIp, fetchImpl = fetch) {
  if (!secretKey) return { ok: false, reason: 'not_configured' };
  if (!token || typeof token !== 'string') return { ok: false, reason: 'missing_token' };

  const body = new URLSearchParams({ secret: secretKey, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);

  let res;
  try {
    res = await fetchImpl(VERIFY_URL, { method: 'POST', body });
  } catch (err) {
    return { ok: false, reason: `verify_request_failed: ${err?.message ?? err}` };
  }
  if (!res.ok) return { ok: false, reason: `verify_http_${res.status}` };

  const data = await res.json();
  if (data.success === true) return { ok: true };
  return { ok: false, reason: `challenge_failed: ${(data['error-codes'] ?? []).join(',') || 'unknown'}` };
}
