import { Router, type Response as ExpressResponse } from 'express';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get(/^\/playback\/playlist\/(.*)$/, requireAuth, async (req, res) => {
  const tail = req.params[0] ?? '';
  const query = req.url.indexOf('?');
  const search = query >= 0 ? req.url.slice(query) : '';
  const upstreamUrl = `https://vixsrc.to/playlist/${tail}${search}`;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      headers: {
        accept: req.headers.accept ?? '*/*',
        'accept-encoding': 'identity',
        referer: 'https://vixsrc.to/',
        origin: 'https://vixsrc.to'
      }
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'upstream_fetch_failed';
    res.status(502).json({ error: 'playlist_proxy_failed', detail });
    return;
  }

  const contentType = upstream.headers.get('content-type') ?? '';
  const isPlaylist = contentType.includes('mpegurl') || contentType.includes('m3u8');

  if (!isPlaylist) {
    copyHeaders(upstream, res, false);
    res.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
    return;
  }

  const body = await upstream.text();
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

export default router;
