import { config } from '../config';
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { SocksProxyAgent } from 'socks-proxy-agent';

const warpAgent = config.warpSocksUrl ? new SocksProxyAgent(config.warpSocksUrl) : null;

type EgressOptions = {
  headers?: Record<string, string>;
  timeoutMs?: number;
  viaWarp?: boolean;
};

/** Fetch directly or through the configured WARP SOCKS proxy. */
export async function fetchWithEgress(url: string, opts: EgressOptions = {}): Promise<Response> {
  if (!opts.viaWarp) {
    return fetch(url, {
      headers: opts.headers,
      signal: AbortSignal.timeout(opts.timeoutMs ?? config.upstreamTimeoutMs),
      redirect: 'follow'
    });
  }
  if (!warpAgent) throw new Error('WARP non configurato sul proxy. Imposta WARP_SOCKS_URL.');

  const get = async (target: string, redirects = 0): Promise<Response> => {
    if (redirects > 5) throw new Error('Troppi redirect WARP.');
    const parsed = new URL(target);
    const client = parsed.protocol === 'https:' ? https : http;
    return new Promise<Response>((resolve, reject) => {
      const req = client.request(parsed, {
        headers: opts.headers,
        agent: warpAgent,
        signal: AbortSignal.timeout(opts.timeoutMs ?? config.upstreamTimeoutMs)
      }, (res) => {
        const status = res.statusCode ?? 502;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          res.resume();
          void get(new URL(location, parsed).href, redirects + 1).then(resolve, reject);
          return;
        }
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value != null) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        }
        resolve(new Response(Readable.toWeb(res) as ReadableStream, { status, headers }));
      });
      req.once('error', reject);
      req.end();
    });
  };

  // `go run` needs a moment to compile/start the internal WARP sidecar on its
  // first launch. Wait for its SOCKS listener instead of failing the first use.
  // Cap total wait at ~8s (8 attempts x 1s) so a permanently-down sidecar
  // doesn't block every request for 20 seconds.
  const WARP_WAIT_MAX = 8;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await get(url);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ECONNREFUSED' || attempt >= WARP_WAIT_MAX - 1) {
        if ((e as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
          throw new Error('WARP sidecar non raggiungibile. Avvia il proxy con WARP o riprova.');
        }
        throw e;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

/**
 * Fetch an upstream URL with vixcloud headers (Referer/Origin) + desktop UA and
 * a timeout. Returns the global Response. Throws on non-2xx.
 * Uses the WARP SOCKS egress when the session requested it.
 */
export async function fetchUpstream(url: string, opts: EgressOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'User-Agent': config.userAgent,
    Accept: 'text/html,application/xhtml+xml,application/vnd.apple.mpegurl,*/*;q=0.8',
    ...config.vixHeaders,
    ...opts.headers
  };
  const res = await fetchWithEgress(url, { ...opts, headers });
  if (!res.ok) {
    // Drain to free the connection.
    try {
      await res.arrayBuffer();
    } catch {
      /* ignore */
    }
    throw new UpstreamError(res.status, `upstream ${res.status} for ${url}`);
  }
  return res;
}

export class UpstreamError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
