// The weaker link check, named honestly (founder ruling, 2026-09-20: "Do
// not fake a liveness check we cannot perform").
//
// A Smoothcomp registration URL is an event page, and every event page
// returns 403 to us. There is no honest way to confirm such a link is live,
// so this confirms only what CAN be confirmed without a request: the URL is
// well-formed, https, and points at a hostname this crawl has an approved,
// active alias for. That is weaker than a 200 and is recorded as such
// (link_check_method='structural') so the console can show a reviewer it
// means less.
export function structuralLinkVerdict(rawUrl, approvedHosts) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    return { ok: false, reason: `not a URL: ${String(rawUrl)}` };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: `not https (${url.protocol.replace(':', '')})` };
  const host = url.hostname.toLowerCase();
  const approved = approvedHosts instanceof Set ? approvedHosts : new Set(approvedHosts ?? []);
  if (!approved.has(host)) return { ok: false, reason: `${host} is not an approved alias of this source` };
  return { ok: true, host };
}
