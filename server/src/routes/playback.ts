import { Router, type Request, type Response as ExpressResponse } from 'express';
import { authenticateToken, respondAuthFailure } from '../middleware/auth';
import { playbackLogger } from '../services/playback-logs';
import { fetchWithTimeout } from '../utils/fetch';
import { hasValidVixcloudSignature } from '../utils/vix-token';

/* Higher than the 8s default used for TMDB / provider search because the
 * playlist proxy sits on the playback critical path — a slow vixcloud
 * response is still preferable to a 502 here. 30s matches the upper end of
 * what users will tolerate before retrying anyway. */
const PLAYLIST_FETCH_TIMEOUT_MS = 30000;
const STREAMING_QUALITY_COOKIE = 'streaming_max_height';
const ALLOWED_STREAMING_HEIGHTS = new Set([480, 720, 1080]);

const router = Router();

router.get(/^\/playback\/playlist\/(.*)$/, async (req, res) => {
  const tail = req.params[0] ?? '';
  const query = req.url.indexOf('?');
  const search = query >= 0 ? req.url.slice(query) : '';
  const upstreamUrl = `https://vixcloud.co/playlist/${tail}${search}`;
  const authed = await authorizePlaybackRequest(req, res, upstreamUrl);
  if (!authed) return;

  playbackLogger.info('playlist start', {
    user: req.user?.email ?? '-',
    upstream: upstreamUrl
  });

  let upstream: Response;
  try {
    upstream = await fetchWithTimeout(upstreamUrl, {
      referrerPolicy: 'no-referrer',
      headers: {
        accept: req.headers.accept ?? '*/*',
        'accept-encoding': 'identity',
        origin: 'https://vixcloud.co'
      }
    }, PLAYLIST_FETCH_TIMEOUT_MS);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'upstream_fetch_failed';
    playbackLogger.error('playlist fetch failed', {
      user: req.user?.email ?? '-',
      upstream: upstreamUrl,
      detail
    });
    res.status(502).json({ error: 'playlist_proxy_failed', detail });
    return;
  }

  const contentType = upstream.headers.get('content-type') ?? '';
  const isPlaylist = contentType.includes('mpegurl') || contentType.includes('m3u8');
  playbackLogger.info('playlist upstream response', {
    user: req.user?.email ?? '-',
    status: upstream.status,
    contentType: contentType || '-',
    playlist: isPlaylist
  });

  if (!isPlaylist) {
    copyHeaders(upstream, res, false);
    res.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
    return;
  }

  const body = await upstream.text();
  const maxHeight = streamingMaxHeight(req);
  const filteredBody = filterMasterToHeight(body, maxHeight);
  logPlaylistDetails(req.user?.email ?? '-', upstreamUrl, body);
  if (filteredBody !== body) {
    playbackLogger.info('playlist quality forced', {
      user: req.user?.email ?? '-',
      upstream: upstreamUrl,
      maxHeight
    });
  }
  copyHeaders(upstream, res, true);
  res.status(upstream.status).send(rewritePlaylist(filteredBody));
});

function streamingMaxHeight(req: Request): number {
  const parsed = Number.parseInt(String(req.cookies?.[STREAMING_QUALITY_COOKIE] ?? ''), 10);
  return ALLOWED_STREAMING_HEIGHTS.has(parsed) ? parsed : 0;
}

/**
 * Keep exactly one variant in an HLS master playlist. This mirrors the iOS
 * proxy: choose the highest resolution at or below the requested cap, fall
 * back to the lowest variant when every stream is taller, and use bandwidth
 * when the master does not expose RESOLUTION attributes.
 */
export function filterMasterToHeight(body: string, maxHeight: number): string {
  if (maxHeight <= 0) return body;

  const lines = body.split(/\r?\n/);
  const blocks: Array<{ infIndex: number; uriIndex: number; bandwidth: number; height: number }> = [];

  for (let i = 0; i < lines.length; i += 1) {
    const inf = lines[i].trim();
    if (!inf.startsWith('#EXT-X-STREAM-INF')) continue;

    let uriIndex = i + 1;
    while (uriIndex < lines.length) {
      const candidate = lines[uriIndex].trim();
      if (candidate && !candidate.startsWith('#')) break;
      uriIndex += 1;
    }
    if (uriIndex >= lines.length) continue;

    const bandwidth = Number.parseInt(inf.match(/(?:^|,)BANDWIDTH=(\d+)/i)?.[1] ?? '0', 10);
    const height = Number.parseInt(inf.match(/(?:^|,)RESOLUTION=\d+x(\d+)/i)?.[1] ?? '0', 10);
    blocks.push({ infIndex: i, uriIndex, bandwidth, height });
  }

  if (blocks.length <= 1) return body;

  const withHeight = blocks.filter((block) => block.height > 0);
  let chosen: (typeof blocks)[number];
  if (withHeight.length > 0) {
    const eligible = withHeight.filter((block) => block.height <= maxHeight);
    chosen = eligible.length > 0
      ? eligible.reduce((best, block) => block.height > best.height ? block : best)
      : withHeight.reduce((best, block) => block.height < best.height ? block : best);
  } else {
    chosen = blocks.reduce((best, block) => block.bandwidth > best.bandwidth ? block : best);
  }

  const droppedLines = new Set<number>();
  for (const block of blocks) {
    if (block.uriIndex === chosen.uriIndex) continue;
    droppedLines.add(block.infIndex);
    droppedLines.add(block.uriIndex);
  }

  return lines.filter((_line, index) => !droppedLines.has(index)).join('\n');
}

async function authorizePlaybackRequest(req: Request, res: ExpressResponse, upstreamUrl: string): Promise<boolean> {
  const result = await authenticateToken(req.cookies?.token);
  if (result.user) {
    req.user = result.user;
    return true;
  }

  // Bypass for AirPlay/Cast: vixcloud-signed URLs with non-expired
  // `token=&expires=` are accepted in lieu of the session cookie since the
  // remote device fetches the stream directly and can't carry our cookie.
  if (hasValidVixcloudSignature(req.originalUrl || req.url)) {
    return true;
  }

  playbackLogger.warn('playlist auth denied', {
    reason: result.error ?? 'unauthenticated',
    upstream: upstreamUrl,
    requestUri: req.originalUrl || req.url,
    ip: req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '-'
  });
  respondAuthFailure(req, res, result.error ?? 'unauthenticated', 'playback request auth denied');
  return false;
}

function rewritePlaylist(body: string): string {
  return body
    .replace(
      /https?:\/\/([a-z0-9-]+)\.vix-content\.net(\/[^\s"']*)/gi,
      '/cdn/$1$2'
    )
    .replace(
      /\/\/([a-z0-9-]+)\.vix-content\.net(\/[^\s"']*)/gi,
      '/cdn/$1$2'
    )
    .replace(
      /https?:\/\/vixcloud\.co(\/(?:playlist|storage|build)\/[^\s"']*|\/jwplayer-[^\s"']*|\/favicon\.ico)/gi,
      '$1'
    )
    .replace(
      /\/\/vixcloud\.co(\/(?:playlist|storage|build)\/[^\s"']*|\/jwplayer-[^\s"']*|\/favicon\.ico)/gi,
      '$1'
    )
    .replace(
      /https?:\/\/vixcloud\.co(\/[^\s"']*)/gi,
      '/vixcloud$1'
    )
    .replace(
      /\/\/vixcloud\.co(\/[^\s"']*)/gi,
      '/vixcloud$1'
    );
}

function copyHeaders(upstream: Response, res: ExpressResponse, isPlaylist: boolean): void {
  const passthrough = [
    'cache-control',
    'etag',
    'last-modified',
    'expires',
    'accept-ranges'
  ];

  for (const name of passthrough) {
    const value = upstream.headers.get(name);
    if (value) {
      res.setHeader(name, value);
    }
  }

  if (isPlaylist) {
    res.type('application/vnd.apple.mpegurl');
    return;
  }

  const contentType = upstream.headers.get('content-type');
  if (contentType) {
    res.setHeader('content-type', contentType);
  }
}

function logPlaylistDetails(user: string, upstreamUrl: string, body: string): void {
  if (!body.includes('#EXTM3U')) {
    return;
  }

  if (body.includes('#EXT-X-STREAM-INF')) {
    const variants = collectMasterVariants(body);
    playbackLogger.info('playlist master', {
      user,
      upstream: upstreamUrl,
      variants
    });
    return;
  }

  const segmentCount = (body.match(/^#EXTINF:/gm) ?? []).length;
  const keyMatch = body.match(/#EXT-X-KEY:.*URI="([^"]+)"/i);
  const firstSegment = body
    .split(/\r?\n/)
    .find((line) => line.length > 0 && !line.startsWith('#'));

  playbackLogger.info('playlist media', {
    user,
    upstream: upstreamUrl,
    segments: segmentCount,
    key: keyMatch?.[1] ?? '-',
    firstSegment: firstSegment ?? '-'
  });
}

function collectMasterVariants(body: string): string[] {
  const lines = body.split(/\r?\n/);
  const variants: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.startsWith('#EXT-X-STREAM-INF:')) {
      continue;
    }

    const nextLine = lines[i + 1] ?? '-';
    const resolution = line.match(/(?:^|,)RESOLUTION=([^,]+)/i)?.[1] ?? '-';
    const bandwidth = line.match(/(?:^|,)BANDWIDTH=([^,]+)/i)?.[1] ?? '-';
    variants.push(`res=${resolution},bw=${bandwidth},uri=${nextLine}`);
  }

  return variants;
}

export default router;
