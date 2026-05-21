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
  logPlaylistDetails(req.user?.email ?? '-', upstreamUrl, body);
  copyHeaders(upstream, res, true);
  res.status(upstream.status).send(rewritePlaylist(body));
});

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
