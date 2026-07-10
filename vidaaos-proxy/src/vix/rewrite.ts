// HLS playlist rewriting — port of LocalHlsProxy.kt (pure string/regex over m3u8).
// Every internal URI (variant, media, segment, key) is rewritten to route back
// through the proxy so the browser never fetches upstream directly (the vixcloud
// token is IP-bound to the proxy; Referer/Origin can't be set by <video>).

/** base64url without padding (matches Android Base64.URL_SAFE | NO_WRAP | NO_PADDING). */
export function encodeUrl(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}
export function decodeUrl(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8');
}

/** Rewrite any internal URI (variant/media/segment/key) to the generic proxy
 * /vix/r handle — the proxy auto-detects playlist-vs-segment at serve time
 * (mirrors LocalHlsProxy.serve / /r?u=). */
export function proxify(absoluteUrl: string, sessionId: string): string {
  return `/vix/r/${sessionId}?u=${encodeUrl(absoluteUrl)}`;
}

/** Replace URI="..." attrs (EXT-X-MEDIA keys, etc.) to point through the proxy. */
export function rewriteUriAttr(line: string, base: string, sessionId: string): string {
  return line.replace(/URI="([^"]*)"/g, (_m, g1: string) => {
    const abs = new URL(g1, base).href;
    return `URI="${proxify(abs, sessionId)}"`;
  });
}

/**
 * Media playlist (segment list): rewrite every URI to the proxy.
 * Forces #EXT-X-ENDLIST when missing but segments exist (vixcloud VOD playlists
 * sometimes lack ENDLIST; hls.js treats that as LIVE and errors at the live edge).
 * Port of LocalHlsProxy.rewriteMedia.
 */
export function rewriteMedia(lines: string[], base: string, sessionId: string): string {
  const rewritten = lines
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed === '') return line;
      if (trimmed.startsWith('#')) {
        return line.includes('URI="') ? rewriteUriAttr(line, base, sessionId) : line;
      }
      return proxify(new URL(trimmed, base).href, sessionId);
    })
    .join('\n');

  const hasSegment = lines.some((l) => l.trimStart().startsWith('#EXTINF'));
  const hasEndlist = lines.some((l) => l.trimStart().startsWith('#EXT-X-ENDLIST'));
  if (hasSegment && !hasEndlist) {
    return rewritten.trimEnd() + '\n#EXT-X-ENDLIST\n';
  }
  return rewritten;
}

/**
 * Master multivariant playlist: keep ONLY the max-BANDWIDTH variant + audio/sub
 * EXT-X-MEDIA tracks. Used only when ?single=1 (DLNA-style picky renderers).
 * hls.js path uses rewriteMedia over the master (keeps all variants for ABR).
 * Port of LocalHlsProxy.rewriteMasterKeepBest.
 */
export function rewriteMasterKeepBest(lines: string[], base: string, sessionId: string): string {
  const out: string[] = [];
  let bestBw = -1;
  let bestInf: string | null = null;
  let bestUri: string | null = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('#EXT-X-STREAM-INF')) {
      const bwMatch = /BANDWIDTH=(\d+)/.exec(trimmed);
      const bw = bwMatch ? Number(bwMatch[1]) : 0;
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      const uri = j < lines.length ? lines[j].trim() : '';
      if (bw > bestBw) {
        bestBw = bw;
        bestInf = line;
        bestUri = uri;
      }
      i = j + 1;
      continue;
    }
    if (trimmed !== '') {
      out.push(trimmed.startsWith('#') && line.includes('URI="') ? rewriteUriAttr(line, base, sessionId) : line);
    }
    i++;
  }
  if (bestInf != null && bestUri != null) {
    out.push(bestInf);
    out.push(proxify(new URL(bestUri, base).href, sessionId));
  }
  return out.join('\n');
}

/** Branch master vs media by #EXT-X-STREAM-INF. Port of rewritePlaylist. */
export function rewritePlaylist(text: string, base: string, sessionId: string, singleVariant = false): string {
  const lines = text.split('\n');
  const isMaster = lines.some((l) => l.trimStart().startsWith('#EXT-X-STREAM-INF'));
  return isMaster && singleVariant
    ? rewriteMasterKeepBest(lines, base, sessionId)
    : rewriteMedia(lines, base, sessionId);
}

// ponytail self-check: a sample master must rewrite every variant URI to /vix/seg.
// Run: npm run check  (tsx src/vix/rewrite.ts)
function demo() {
  const master = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360',
    'low.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720',
    'high.m3u8',
    ''
  ].join('\n');
  const base = 'https://vixcloud.co/playlist/123?token=t&expires=e';
  const out = rewritePlaylist(master, base, 'sess', false);
  const segCount = (out.match(/\/vix\/r\/sess\?u=/g) || []).length;
  console.assert(segCount === 2, `expected 2 proxied variants, got ${segCount}`);
  console.assert(out.includes('#EXT-X-ENDLIST') === false, 'master must not get ENDLIST');
  // media playlist ENDLIST forcing
  const media = ['#EXTM3U', '#EXTINF:10,', 'seg1.ts', '#EXTINF:10,', 'seg2.ts', ''].join('\n');
  const outM = rewritePlaylist(media, base + '/media', 'sess', false);
  console.assert(outM.endsWith('#EXT-X-ENDLIST\n'), 'media without ENDLIST must be forced to VOD');
  console.assert(outM.includes('/vix/r/sess?u='), 'segments must be proxied');
  // keepBest keeps only the top variant
  const outK = rewritePlaylist(master, base, 'sess', true);
  const segK = (outK.match(/\/vix\/r\/sess\?u=/g) || []).length;
  console.assert(segK === 1, `keepBest should keep 1 variant, got ${segK}`);
  console.log('rewrite.ts demo: OK');
}

if (process.argv[1] && process.argv[1].endsWith('rewrite.ts')) demo();