// POST /vix/resolve — owns the vixcloud HLS chain from the embed URL.
// Port of VixcloudClient.kt extraction (regexes + buildPlaylistURLs + parseStreams).
// The app hands us the embed URL (no IP-bound tokens on that path); we extract
// token/expires/url/window.streams, build the ordered master list, and store it
// in a session. The browser only ever sees proxy handles.

import { config } from '../config';
import { fetchWithEgress } from './fetch';
import { createSession, type Session, type SessionSource } from './session';

const TOKEN_PATTERNS = [
  /'token'\s*:\s*'([^']+)'/,
  /"token"\s*:\s*"([^"]+)"/,
  /token:\s*'([^']+)'/,
  /token:\s*"([^"]+)"/
];
const EXPIRES_PATTERNS = [
  /'expires'\s*:\s*'([^']+)'/,
  /"expires"\s*:\s*"([^"]+)"/,
  /expires:\s*'([^']+)'/,
  /expires:\s*"([^"]+)"/
];
const URL_PATTERNS = [/url:\s*'([^']+)'/, /url:\s*"([^"]+)"/, /"url"\s*:\s*"([^"]+)"/];
const CAN_PLAY_FHD_PATTERN = /window\.canPlayFHD\s*=\s*(true|false)/;
const STREAMS_PATTERN = /window\.streams\s*=\s*(\[.*?\])/s;

function extractFirst(text: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = p.exec(text);
    if (m && m.length > 1) return m[1];
  }
  return null;
}

interface StreamEntry {
  name?: string;
  active?: boolean;
  url?: string;
}
function parseStreams(html: string): StreamEntry[] {
  const m = STREAMS_PATTERN.exec(html);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[1]) as any[];
    return arr.map((obj) => ({
      name: obj?.name ?? '',
      active: obj?.active ?? false,
      url: obj?.url ?? ''
    }));
  } catch {
    return [];
  }
}

/** Append token/expires/h=1 if not already present. Mirrors withParams. */
function withParams(base: string, token: string | null, expires: string | null, canFHD: boolean): string | null {
  let parsed: URL;
  try {
    parsed = new URL(base.trim());
  } catch {
    return null;
  }
  if (token && !parsed.searchParams.has('token')) parsed.searchParams.set('token', token);
  if (expires && !parsed.searchParams.has('expires')) parsed.searchParams.set('expires', expires);
  if (canFHD && !parsed.searchParams.has('h')) parsed.searchParams.set('h', '1');
  return parsed.href;
}

/** Build the ordered master list: primary masterPlaylist.url, then window.streams (active first). */
export function buildPlaylistURLs(html: string): string[] {
  const token = extractFirst(html, TOKEN_PATTERNS);
  const expires = extractFirst(html, EXPIRES_PATTERNS);
  const canFHD = extractFirst(html, [CAN_PLAY_FHD_PATTERN]) === 'true';

  const bases: string[] = [];
  const masterUrl = extractFirst(html, URL_PATTERNS);
  if (masterUrl) bases.push(masterUrl);

  const streams = parseStreams(html);
  streams
    .slice()
    .sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1))
    .forEach((s) => {
      if (s.url) bases.push(s.url.replace(/\\\//g, '/'));
    });

  const withTokens = bases.map((b) => withParams(b, token, expires, canFHD)).filter((x): x is string => !!x);
  return Array.from(new Set(withTokens));
}

/** Fetch the embed HTML (UA + Accept only — NO vixcloud Referer/Origin, mirrors VixcloudClient.fetchHTML). */
async function fetchEmbedHtml(embedUrl: string, viaWarp: boolean): Promise<string> {
  const res = await fetchWithEgress(embedUrl, {
    headers: {
      'User-Agent': config.userAgent,
      Accept: 'text/html,application/xhtml+xml,*/*'
    },
    timeoutMs: config.upstreamTimeoutMs,
    viaWarp
  });
  if (!res.ok) throw new Error(`embed fetch ${res.status}`);
  return await res.text();
}

export interface ResolveResult {
  sessionId: string;
  sources: { id: string; label: string }[];
}

export async function resolve(embedUrl: string, warp: boolean): Promise<ResolveResult> {
  const html = await fetchEmbedHtml(embedUrl, warp);
  const urls = buildPlaylistURLs(html);
  if (urls.length === 0) throw new Error('Stream non trovato nella pagina del player.');

  const sources: SessionSource[] = urls.map((url, i) => ({
    id: String(i),
    label: i === 0 ? 'Principale' : `Server ${i}`,
    upstreamMaster: url
  }));

  const session: Session = createSession({
    sources,
    headers: { ...config.vixHeaders },
    viaWarp: warp
  });
  return { sessionId: session.id, sources: sources.map((s) => ({ id: s.id, label: s.label })) };
}
