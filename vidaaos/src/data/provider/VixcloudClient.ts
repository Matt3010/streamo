// Delegates the vixcloud HLS chain to the backend proxy. The browser <video>
// can't set Referer/Origin and the vixcloud token is IP-bound, so the proxy owns
// master/media/segments end-to-end. The app only gets opaque proxy handles.
// This is the single divergence from Android VixcloudClient — and the reason
// the proxy exists.
import type { PlaybackSource } from './models';

// In dev the Vite proxy forwards same-origin /vix/* to the backend, so the
// default is empty (relative). Set VITE_PROXY_ORIGIN for production where the
// proxy is a separate host. Empty → relative URLs → no CORS/mixed-content.
const PROXY_ORIGIN = (import.meta.env?.VITE_PROXY_ORIGIN as string | undefined) || '';

export class VixError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VixError';
  }
}

/**
 * Resolve an embed URL to an ordered list of playable sources via the proxy.
 * Each playlistUrl is a proxy master URL; hls.js loads it directly.
 */
export async function playbackSources(embedUrl: string, warp: boolean): Promise<PlaybackSource[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${PROXY_ORIGIN}/vix/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embedUrl, warp }),
      signal: ctrl.signal
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new VixError(text || `Proxy resolve HTTP ${res.status}`);
    }
    const data = (await res.json()) as { sessionId: string; sources: { id: string; label: string }[] };
    if (!data.sources?.length) throw new VixError('Stream non trovato nella pagina del player.');
    // ponytail: browser can't set Referer/Origin on hls.js XHRs; the proxy injects
    // them upstream. So PlaybackSource.headers is empty here.
    return data.sources.map(
      (s): PlaybackSource => ({
        playlistUrl: `${PROXY_ORIGIN}/vix/master/${data.sessionId}/${s.id}`,
        headers: {}
      })
    );
  } finally {
    clearTimeout(timer);
  }
}