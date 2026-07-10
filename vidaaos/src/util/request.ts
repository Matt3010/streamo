// HTTP GET wrapper for provider fetches (telegra.ph + StreamingCommunity).
// The browser CANNOT fetch these cross-origin (CORS) nor set User-Agent/Referer
// (forbidden headers), so every request is routed through the backend proxy's
// /prov pass-through, which fetches server-side with a desktop UA and no
// Referer (mirrors Android ProviderClient.get). In dev the Vite proxy forwards
// /prov to the backend; in production set VITE_PROXY_ORIGIN.
//
// The proxy returns the upstream body with its content-type, so JSON-vs-HTML
// detection (inertia) still works.

import { settings } from '../data/settings';

const PROXY_ORIGIN = (import.meta.env?.VITE_PROXY_ORIGIN as string | undefined) || '';
const TIMEOUT_MS = 8000;

export interface HttpResponse {
  body: string;
  contentType: string | null;
}

export async function httpGet(
  url: string,
  _accept = 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  _extraHeaders: Record<string, string> = {}
): Promise<HttpResponse | null> {
  // ponytail: _accept/_extraHeaders are accepted for signature parity with the
  // Android shape but ignored — the proxy owns upstream headers (UA/Referer).
  const proxied = `${PROXY_ORIGIN}/prov?url=${encodeURIComponent(url)}&warp=${settings.warpEnabled.value ? '1' : '0'}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(proxied, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) return null;
    const body = await res.text();
    return { body, contentType: res.headers.get('content-type') };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
