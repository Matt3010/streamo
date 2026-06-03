// Vixcloud playback: resolves an embed page into proxied HLS playlist URLs and
// proxies playlists/segments/keys so players never talk to vixcloud directly.
// Playlist URLs are rewritten to relative /cdn|/vixcloud|/playlist paths with
// the auth key embedded (players send no custom headers).

import type { Request, Response as ExpressResponse } from 'express';
import { Readable } from 'node:stream';
import { authToken } from './auth.js';
import { fetchEmbedURL, seasonEpisodes } from './catalog.js';
import { extractAny, fetchText, fetchWithTimeout, firstMatch, headerValue, querySuffix } from './util.js';

const PLAYLIST_FETCH_TIMEOUT_MS = 30000;
const EMBED_FETCH_TIMEOUT_MS = 15000;

export type PlaybackSources = {
  sources: Array<{ url: string }>;
  reason: 'not_found' | 'temporarily_unavailable' | null;
};

// --- Source resolution ---------------------------------------------------------

export async function resolveMovieSources(titleId: number, publicBaseURL: string): Promise<PlaybackSources> {
  const embedURL = await fetchEmbedURL(titleId);
  if (!embedURL) {
    return { sources: [], reason: 'temporarily_unavailable' };
  }
  return resolvePlaybackSources(embedURL, publicBaseURL);
}

export async function resolveEpisodeSources(
  titleId: number,
  slug: string,
  seasonNumber: number,
  episodeNumber: number,
  publicBaseURL: string
): Promise<PlaybackSources> {
  const episodes = await seasonEpisodes(titleId, slug, seasonNumber);
  const match = episodes?.find((episode) => episode.number === episodeNumber);
  if (!match) {
    return { sources: [], reason: episodes?.length ? 'not_found' : 'temporarily_unavailable' };
  }

  const embedURL = await fetchEmbedURL(titleId, match.id);
  if (!embedURL) {
    return { sources: [], reason: 'temporarily_unavailable' };
  }
  return resolvePlaybackSources(embedURL, publicBaseURL);
}

async function resolvePlaybackSources(embedURL: string, publicBaseURL: string): Promise<PlaybackSources> {
  const html = await fetchText(embedURL, {
    accept: 'text/html,application/xhtml+xml,*/*'
  }, EMBED_FETCH_TIMEOUT_MS);
  if (!html) {
    return { sources: [], reason: 'temporarily_unavailable' };
  }

  const urls = buildPlaylistURLs(html)
    .map((url) => proxiedPlaylistURL(publicBaseURL, url))
    .filter((url): url is string => Boolean(url));

  if (urls.length === 0) {
    return { sources: [], reason: 'temporarily_unavailable' };
  }

  return { sources: urls.map((url) => ({ url })), reason: null };
}

function buildPlaylistURLs(html: string): URL[] {
  const token = extractAny(html, [
    /'token'\s*:\s*'([^']+)'/i,
    /"token"\s*:\s*"([^"]+)"/i,
    /token:\s*'([^']+)'/i,
    /token:\s*"([^"]+)"/i
  ]);
  const expires = extractAny(html, [
    /'expires'\s*:\s*'([^']+)'/i,
    /"expires"\s*:\s*"([^"]+)"/i,
    /expires:\s*'([^']+)'/i,
    /expires:\s*"([^"]+)"/i
  ]);
  const canFhd = extractAny(html, [/window\.canPlayFHD\s*=\s*(true|false)/i]) === 'true';

  const bases: string[] = [];
  const master = extractAny(html, [
    /url:\s*'([^']+)'/i,
    /url:\s*"([^"]+)"/i,
    /"url"\s*:\s*"([^"]+)"/i
  ]);
  if (master) {
    bases.push(master);
  }

  for (const stream of parseStreams(html).sort((a, b) => activeSortValue(a.active) - activeSortValue(b.active))) {
    if (stream.url) {
      bases.push(stream.url.replace(/\\\//g, '/'));
    }
  }

  const seen = new Set<string>();
  return bases
    .map((base) => withPlaylistParams(base, token, expires, canFhd))
    .filter((url): url is URL => Boolean(url))
    .filter((url) => {
      const key = url.toString();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function withPlaylistParams(base: string, token: string | null, expires: string | null, canFhd: boolean): URL | null {
  try {
    const components = new URL(base.trim());
    if (token && !components.searchParams.has('token')) {
      components.searchParams.set('token', token);
    }
    if (expires && !components.searchParams.has('expires')) {
      components.searchParams.set('expires', expires);
    }
    if (canFhd && !components.searchParams.has('h')) {
      components.searchParams.set('h', '1');
    }
    return components;
  } catch {
    return null;
  }
}

function parseStreams(html: string): Array<{ active?: boolean; url?: string | null }> {
  const raw = firstMatch(html, /window\.streams\s*=\s*(\[.*?\])/is);
  if (!raw) {
    return [];
  }
  try {
    return (JSON.parse(raw) as Array<{ active?: boolean; url?: string | null }>) ?? [];
  } catch {
    return [];
  }
}

function activeSortValue(value: boolean | undefined): number {
  return value ? 0 : 1;
}

/// Maps the vixcloud master-playlist URL to OUR public proxy URL, with the
/// auth key embedded so players can fetch it without headers.
function proxiedPlaylistURL(publicBaseURL: string, upstreamURL: URL): string | null {
  if (upstreamURL.hostname !== 'vixcloud.co' || !upstreamURL.pathname.startsWith('/playlist/')) {
    return null;
  }
  const suffix = upstreamURL.search ? '&' : '?';
  return `${publicBaseURL}${upstreamURL.pathname}${upstreamURL.search}${suffix}key=${encodeURIComponent(authToken)}`;
}

// --- HLS proxy ------------------------------------------------------------------

export async function proxyPlaylist(req: Request, res: ExpressResponse, tail: string): Promise<void> {
  const search = querySuffix(req.url);   // strips our `key` before hitting vixcloud
  const upstreamURL = `https://vixcloud.co/playlist/${tail}${search}`;

  let upstream: globalThis.Response;
  try {
    upstream = await fetchWithTimeout(upstreamURL, {
      headers: {
        accept: headerValue(req.headers.accept, '*/*'),
        'accept-encoding': 'identity',
        origin: 'https://vixcloud.co'
      },
      referrerPolicy: 'no-referrer'
    }, PLAYLIST_FETCH_TIMEOUT_MS);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'upstream_fetch_failed';
    res.status(502).json({ error: 'playlist_proxy_failed', detail });
    return;
  }

  const contentType = upstream.headers.get('content-type') ?? '';
  const isPlaylist = contentType.includes('mpegurl') || contentType.includes('m3u8') || tail.endsWith('.m3u8');

  if (!isPlaylist) {
    await forwardResponse(upstream, res);
    return;
  }

  const body = await upstream.text();
  copyProxyHeaders(upstream, res, true);
  res.status(upstream.status).send(rewritePlaylist(body));
}

export async function proxyPassthrough(
  req: Request,
  res: ExpressResponse,
  upstreamURL: string
): Promise<void> {
  let upstream: globalThis.Response;
  try {
    upstream = await fetchWithTimeout(upstreamURL, {
      headers: {
        accept: headerValue(req.headers.accept, '*/*'),
        Referer: '',
        Cookie: '',
        Authorization: '',
        'Proxy-Authorization': '',
        'X-Forwarded-For': '',
        Forwarded: ''
      }
    }, PLAYLIST_FETCH_TIMEOUT_MS);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'upstream_fetch_failed';
    res.status(502).json({ error: 'proxy_failed', detail });
    return;
  }

  // Nested variant/media playlists (referenced from an already-rewritten
  // master) can themselves carry absolute vixcloud.co / vix-content.net URLs.
  // Rewrite those too so every sub-playlist, segment and key is pulled back
  // through this proxy.
  const contentType = (upstream.headers.get('content-type') ?? '').toLowerCase();
  const isPlaylist = contentType.includes('mpegurl')
    || contentType.includes('m3u8')
    || /\.m3u8(?:$|\?)/i.test(upstreamURL);
  if (isPlaylist) {
    const body = await upstream.text();
    copyProxyHeaders(upstream, res, true);
    res.status(upstream.status).send(rewritePlaylist(body));
    return;
  }

  await forwardResponse(upstream, res);
}

async function forwardResponse(upstream: globalThis.Response, res: ExpressResponse): Promise<void> {
  copyProxyHeaders(upstream, res, false);
  res.status(upstream.status);

  if (!upstream.body) {
    const body = Buffer.from(await upstream.arrayBuffer());
    res.send(body);
    return;
  }

  Readable.fromWeb(upstream.body as never).pipe(res);
}

function copyProxyHeaders(upstream: globalThis.Response, res: ExpressResponse, isPlaylist: boolean): void {
  const passthrough = [
    'cache-control',
    'etag',
    'last-modified',
    'expires',
    'accept-ranges',
    'content-length',
    'content-type'
  ];

  for (const name of passthrough) {
    const value = upstream.headers.get(name);
    if (value) {
      res.setHeader(name, value);
    }
  }

  if (isPlaylist) {
    res.type('application/vnd.apple.mpegurl');
  }
}

function rewritePlaylist(body: string): string {
  // Step 1: rewrite absolute upstream URLs to proxy-relative paths.
  const rewritten = body
    .replace(/https?:\/\/([a-z0-9-]+)\.vix-content\.net(\/[^\s"']*)/gi, '/cdn/$1$2')
    .replace(/\/\/([a-z0-9-]+)\.vix-content\.net(\/[^\s"']*)/gi, '/cdn/$1$2')
    .replace(/https?:\/\/vixcloud\.co(\/(?:playlist|storage)\/[^\s"']*|\/jwplayer-[^\s"']*|\/favicon\.ico)/gi, '$1')
    .replace(/\/\/vixcloud\.co(\/(?:playlist|storage)\/[^\s"']*|\/jwplayer-[^\s"']*|\/favicon\.ico)/gi, '$1')
    .replace(/https?:\/\/vixcloud\.co(\/[^\s"']*)/gi, '/vixcloud$1')
    .replace(/\/\/vixcloud\.co(\/[^\s"']*)/gi, '/vixcloud$1');

  // Step 2: append our `?key=` (auth) to EVERY proxy-relative URL
  // (sub-playlists, segments, and the EXT-X-KEY/enc.key, which vixcloud often
  // references with a root-relative URL we didn't touch above). Players send
  // no headers, so the key must travel in each sub-resource URL. Skip any
  // that already carry it.
  const suffix = `key=${encodeURIComponent(authToken)}`;
  return rewritten.replace(
    /\/(?:cdn|vixcloud|storage|playlist)\/[^\s"']*/gi,
    (m: string) => (/[?&]key=/.test(m) ? m : (m.includes('?') ? `${m}&${suffix}` : `${m}?${suffix}`))
  );
}
