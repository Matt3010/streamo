import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Readable } from 'node:stream';
import { config } from './config';
import { resolve } from './vix/resolve';
import { getSession, deleteSession } from './vix/session';
import { fetchUpstream, fetchWithEgress, UpstreamError } from './vix/fetch';
import { rewritePlaylist, decodeUrl } from './vix/rewrite';
import * as anime from './anime';
import { isAllowedProvUrl } from './prov-url';

const MIME_HLS = 'application/vnd.apple.mpegurl';
const PROVIDER_LINK_URL = 'https://api.telegra.ph/getPage/Link-Aggiornato-StreamingCommunity-09-29?return_content=true';
const PROVIDER_HOST_TTL_MS = 10 * 60 * 1000;
let providerHost: string | undefined;
let providerHostFetchedAt = 0;

function firstHref(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.map(firstHref).find(Boolean);
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.href === 'string') return record.href;
  return Object.values(record).map(firstHref).find(Boolean);
}

async function refreshProviderHost(viaWarp: boolean): Promise<void> {
  if (providerHost && Date.now() - providerHostFetchedAt < PROVIDER_HOST_TTL_MS) return;
  try {
    const res = await fetchWithEgress(PROVIDER_LINK_URL, {
      headers: { 'User-Agent': config.userAgent, Accept: 'application/json' },
      timeoutMs: config.upstreamTimeoutMs,
      viaWarp
    });
    const href = firstHref(await res.json());
    const parsed = href ? new URL(href) : undefined;
    if (parsed?.protocol === 'https:') {
      providerHost = parsed.hostname.toLowerCase();
      providerHostFetchedAt = Date.now();
    }
  } catch {
    // The caller will reject unknown hosts if Telegraph is unavailable.
  }
}

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: config.corsOrigins,
  methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Range'],
  exposedHeaders: ['Content-Length', 'Content-Range']
});

/** Fetch an upstream URL; if it's a playlist rewrite it, else stream bytes.
 * Port of LocalHlsProxy.serveResource. */
async function serveResource(url: string, sessionId: string, singleVariant: boolean) {
  const session = getSession(sessionId);
  const res = await fetchUpstream(url, { headers: session?.headers ?? {}, viaWarp: session?.viaWarp });
  const contentType = res.headers.get('content-type') ?? '';
  const isPlaylist =
    contentType.toLowerCase().includes('mpegurl') || url.split('?')[0].toLowerCase().endsWith('.m3u8');

  if (isPlaylist) {
    const text = await res.text();
    const rewritten = rewritePlaylist(text, url, sessionId, singleVariant);
    return {
      status: 200,
      headers: { 'content-type': MIME_HLS, 'cache-control': 'no-store' },
      body: rewritten
    };
  }

  // Segment / key — stream through with upstream Content-Type + Content-Length.
  const mime = contentType || 'application/octet-stream';
  const headers: Record<string, string> = { 'content-type': mime };
  const len = res.headers.get('content-length');
  if (len) headers['content-length'] = len;
  // ponytail: cast — global fetch returns a DOM ReadableStream<Uint8Array>;
  // Readable.fromWeb wants Node's ReadableStream type. Runtime is fine.
  const stream = Readable.fromWeb(res.body as any);
  return { status: 200, headers, body: stream };
}

// POST /vix/resolve { embedUrl, warp? } -> { sessionId, sources: [{id,label}] }
app.post('/vix/resolve', async (req, reply) => {
  const { embedUrl, warp } = (req.body ?? {}) as { embedUrl?: string; warp?: boolean };
  if (!embedUrl) return reply.code(400).send({ error: 'embedUrl required' });
  try {
    const result = await resolve(embedUrl, !!warp);
    return reply.send(result);
  } catch (e) {
    req.log.error({ err: (e as Error).message }, 'resolve failed');
    return reply.code(502).send({ error: (e as Error).message });
  }
});

for (const [path, handler] of Object.entries({
  '/anime/browse': (b: any) => anime.browse(b.baseUrl, b.offset),
  '/anime/search': (b: any) => anime.search(b.baseUrl, b.title),
  '/anime/episodes': (b: any) => anime.episodes(b.baseUrl, b.animeId, b.start, b.end),
  '/anime/embed': (b: any) => anime.embed(b.baseUrl, b.animeId, b.episodeId, b.slug),
})) {
  app.post(path, async (req, reply) => {
    try { return reply.send(await handler(req.body ?? {})); }
    catch (e) { req.log.error({ err: (e as Error).message }, 'AnimeUnity failed'); return reply.code(502).send({ error: (e as Error).message }); }
  });
}

// GET /vix/master/:sessionId/:sourceId[?single=1] — entry point: serve the
// stored upstream master, rewritten. Variant URIs route to /vix/r.
app.get('/vix/master/:sessionId/:sourceId', async (req, reply) => {
  const { sessionId, sourceId } = req.params as { sessionId: string; sourceId: string };
  const session = getSession(sessionId);
  if (!session) return reply.code(404).send({ error: 'unknown session' });
  const source = session.sources.find((s) => s.id === sourceId);
  if (!source) return reply.code(404).send({ error: 'unknown source' });
  const singleVariant = (req.query as { single?: string }).single === '1';
  try {
    const out = await serveResource(source.upstreamMaster, sessionId, singleVariant);
    return reply.code(out.status).headers(out.headers).send(out.body);
  } catch (e) {
    const status = e instanceof UpstreamError ? e.status : 502;
    return reply.code(status >= 400 && status < 600 ? status : 502).send({ error: (e as Error).message });
  }
});

// GET /vix/r/:sessionId?u=<base64url> — generic: playlist rewrite or segment stream.
app.get('/vix/r/:sessionId', async (req, reply) => {
  const { sessionId } = req.params as { sessionId: string };
  const u = (req.query as { u?: string }).u;
  if (!u || !getSession(sessionId)) return reply.code(404).send({ error: 'not found' });
  let url: string;
  try {
    url = decodeUrl(u);
  } catch {
    return reply.code(400).send({ error: 'bad u' });
  }
  try {
    const out = await serveResource(url, sessionId, false);
    return reply.code(out.status).headers(out.headers).send(out.body);
  } catch (e) {
    const status = e instanceof UpstreamError ? e.status : 502;
    return reply.code(status >= 400 && status < 600 ? status : 502).send({ error: (e as Error).message });
  }
});

// DELETE /vix/session/:sessionId — optional cleanup.
app.delete('/vix/session/:sessionId', async (req, reply) => {
  const { sessionId } = req.params as { sessionId: string };
  deleteSession(sessionId);
  return reply.code(204).send();
});

// GET /prov?url=<encoded> — generic provider pass-through (telegra.ph base
// resolve + StreamingCommunity search/season/iframe). The browser can't fetch
// these cross-origin (CORS), so the proxy fetches server-side with a desktop
// UA and NO Referer (mirrors Android ProviderClient.get). Returns the upstream
// body with its content-type, so the client can detect JSON vs HTML.
// Restricted to known provider hosts to prevent SSRF (the provider base URL
// rotates via telegra.ph, but the host label is always streamingcommunity.*).
app.get('/prov', async (req, reply) => {
  const { url, warp } = req.query as { url?: string; warp?: string };
  if (!url) return reply.code(400).send({ error: 'url required' });
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return reply.code(400).send({ error: 'invalid url' });
  }
  if (!isAllowedProvUrl(parsed, providerHost)) await refreshProviderHost(warp === '1');
  if (!isAllowedProvUrl(parsed, providerHost)) {
    return reply.code(403).send({ error: `host not allowed: ${parsed.hostname}` });
  }
  try {
    const res = await fetchWithEgress(parsed.href, {
      headers: {
        'User-Agent': config.userAgent,
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8'
      },
      timeoutMs: config.upstreamTimeoutMs,
      viaWarp: warp === '1'
    });
    if (!res.ok) return reply.code(502).send({ error: `upstream ${res.status}` });
    const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
    const body = await res.text();
    return reply.type(contentType).send(body);
  } catch (e) {
    return reply.code(502).send({ error: (e as Error).message });
  }
});

// GET /warp/status — verifies that the configured WARP egress is actually active.
app.get('/warp/status', async (_req, reply) => {
  if (!config.warpSocksUrl) return reply.code(503).send({ available: false, message: 'WARP_SOCKS_URL non configurato sul proxy.' });
  try {
    const res = await fetchWithEgress('https://www.cloudflare.com/cdn-cgi/trace', { viaWarp: true, timeoutMs: 8_000 });
    const trace = await res.text();
    const fields = Object.fromEntries(trace.trim().split('\n').map((line) => line.split('=', 2)));
    const active = fields.warp === 'on';
    return reply.send({ available: true, active, ip: fields.ip ?? null, message: active ? `WARP attivo · ${fields.ip}` : 'Il SOCKS risponde ma non usa WARP.' });
  } catch (e) {
    return reply.code(502).send({ available: true, active: false, message: `Verifica WARP fallita: ${(e as Error).message}` });
  }
});

// POST /warp/register — replace the local, free WARP identity without making
// the user manage the internal WARP sidecar.
app.post('/warp/register', async (_req, reply) => {
  try {
    const res = await fetch(config.warpControlUrl, { method: 'POST', signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(await res.text());
    return reply.code(204).send();
  } catch (e) {
    return reply.code(502).send({ error: `Registrazione WARP fallita: ${(e as Error).message}` });
  }
});

app.get('/health', async () => ({ ok: true }));

app.listen({ port: config.port, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`vidaaos-proxy listening on ${address}`);
});
