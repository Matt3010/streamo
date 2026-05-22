import { fetchWithTimeout } from '../utils/fetch';
import type { AdminEgressCheck } from '../../../shared/types';

// Probe the egress path: Cloudflare's own trace endpoint reports whether
// the current outbound IP is going through WARP, plus ipinfo.io adds the
// ASN/org so we can verify it's really Cloudflare's AS13335 and not some
// other tunnel. Both the admin route (manual refresh) and the periodic
// health scan call this — keeps the probe logic in one place.
export async function runEgressCheck(): Promise<AdminEgressCheck> {
  const errors: string[] = [];

  let trace: Record<string, string> = {};
  try {
    const r = await fetchWithTimeout('https://www.cloudflare.com/cdn-cgi/trace', {}, 5000);
    const text = await r.text();
    trace = Object.fromEntries(
      text.split('\n').flatMap((line) => {
        const eq = line.indexOf('=');
        return eq > 0 ? [[line.slice(0, eq), line.slice(eq + 1)]] : [];
      })
    );
  } catch (e) {
    errors.push(`trace: ${e instanceof Error ? e.message : 'fetch_failed'}`);
  }

  let info: { ip?: string; org?: string; country?: string; city?: string } = {};
  try {
    const r = await fetchWithTimeout('https://ipinfo.io/json', {}, 5000);
    info = (await r.json()) as typeof info;
  } catch (e) {
    errors.push(`ipinfo: ${e instanceof Error ? e.message : 'fetch_failed'}`);
  }

  const warp = trace.warp === 'on';
  const org = info.org ?? null;
  const isCloudflare = !!org && /cloudflare/i.test(org);

  return {
    checked_at: Math.floor(Date.now() / 1000),
    ip: trace.ip ?? info.ip ?? null,
    asn_org: org,
    warp,
    colo: trace.colo ?? null,
    country: trace.loc ?? info.country ?? null,
    city: info.city ?? null,
    through_cloudflare: warp && isCloudflare,
    errors
  };
}
