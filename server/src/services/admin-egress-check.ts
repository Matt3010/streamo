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
  const ip = trace.ip ?? info.ip ?? null;
  const isCloudflareByAsn = !!org && /cloudflare/i.test(org);
  const isCloudflareByIp = !!ip && isCloudflareIp(ip);

  return {
    checked_at: Math.floor(Date.now() / 1000),
    ip,
    asn_org: org,
    warp,
    colo: trace.colo ?? null,
    country: trace.loc ?? info.country ?? null,
    city: info.city ?? null,
    // Three independent signals — the trace says warp=on, plus EITHER the
    // ipinfo ASN matches Cloudflare OR the egress IP falls inside a known
    // Cloudflare prefix. The IP check covers the case where ipinfo is
    // flaky / doesn't know the WARP egress range (2a09:bac0::/29 for IPv6
    // isn't in ipinfo's CF labels), which is what caused the earlier
    // false-negative "NON sta passando da WARP" pill.
    through_cloudflare: warp && (isCloudflareByAsn || isCloudflareByIp),
    errors
  };
}

// Known Cloudflare-controlled prefixes — the public CDN ranges plus the
// WARP egress ranges that aren't in the official cloudflare.com/ips list
// but are visibly owned by AS13335 / AS209242 (WARP). Conservative: if
// you see your egress IP coming from one of these, it's via Cloudflare.
const CLOUDFLARE_IPV4_PREFIXES = [
  '173.245.48.', '103.21.244.', '103.22.200.', '103.31.4.',
  '141.101.64.', '108.162.192.', '190.93.240.', '188.114.96.',
  '197.234.240.', '198.41.128.', '162.158.', '172.64.', '172.65.',
  '172.66.', '172.67.', '172.68.', '172.69.', '172.70.', '172.71.',
  '131.0.72.', '104.16.', '104.17.', '104.18.', '104.19.', '104.20.',
  '104.21.', '104.22.', '104.23.', '104.24.', '104.25.', '104.26.',
  '104.27.', '104.28.'
];
// IPv6 prefixes are matched on the first 4 hex segments (= /32) for
// CDN ranges, and on first 3 segments (= /24, covers /29) for WARP.
const CLOUDFLARE_IPV6_PREFIXES = [
  '2400:cb00:', '2606:4700:', '2803:f800:', '2405:b500:',
  '2405:8100:', '2c0f:f248:', '2a06:98c0:',
  // WARP egress — 2a09:bac0::/29 covers bac0..bac7
  '2a09:bac0:', '2a09:bac1:', '2a09:bac2:', '2a09:bac3:',
  '2a09:bac4:', '2a09:bac5:', '2a09:bac6:', '2a09:bac7:'
];

function isCloudflareIp(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower.includes(':')) {
    return CLOUDFLARE_IPV6_PREFIXES.some((p) => lower.startsWith(p));
  }
  return CLOUDFLARE_IPV4_PREFIXES.some((p) => lower.startsWith(p));
}
