import { Router, type Response as ExpressResponse } from 'express';
import { requireAuth } from '../middleware/auth';
import { playbackLogger } from '../services/playback-logs';

const router = Router();

router.get(/^\/playback\/playlist\/(.*)$/, requireAuth, async (req, res) => {
  const tail = req.params[0] ?? '';
  const query = req.url.indexOf('?');
  const search = query >= 0 ? req.url.slice(query) : '';
  const upstreamUrl = `https://vixcloud.co/playlist/${tail}${search}`;
  playbackLogger.info('playlist start', {
    user: req.user?.email ?? '-',
    upstream: upstreamUrl
  });

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      headers: {
        accept: req.headers.accept ?? '*/*',
        'accept-encoding': 'identity',
        referer: 'https://vixcloud.co/',
        origin: 'https://vixcloud.co'
      }
    });
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
    )
    .replace(
      /https?:\/\/vixsrc\.to(\/[^\s"']*)/gi,
      '$1'
    )
    .replace(
      /\/\/vixsrc\.to(\/[^\s"']*)/gi,
      '$1'
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
