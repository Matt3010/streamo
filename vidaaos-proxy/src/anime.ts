import { config } from './config';

const CSRF_TTL = 20 * 60 * 1000;
const SESSION_MAX = 20; // cap: one per AU origin; evict oldest on overflow
const sessions = new Map<string, { csrf: string; expires: number; cookies: Map<string, string> }>();

function base(raw: unknown): string {
  const url = new URL(typeof raw === 'string' ? raw : '');
  if (url.protocol !== 'https:') throw new Error('AnimeUnity URL must use https');
  return url.origin;
}

function session(url: string) {
  let value = sessions.get(url);
  if (!value) {
    // Evict oldest entry if at capacity (Map iterates in insertion order).
    if (sessions.size >= SESSION_MAX) {
      const oldest = sessions.keys().next().value;
      if (oldest !== undefined) sessions.delete(oldest);
    }
    value = { csrf: '', expires: 0, cookies: new Map() };
    sessions.set(url, value);
  }
  return value;
}

function saveCookies(s: ReturnType<typeof session>, headers: Headers): void {
  const values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [headers.get('set-cookie') ?? ''];
  for (const line of values) {
    const first = line.split(';', 1)[0];
    const pos = first.indexOf('=');
    if (pos > 0) s.cookies.set(first.slice(0, pos), first.slice(pos + 1));
  }
}

function cookieHeader(s: ReturnType<typeof session>): string {
  return [...s.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function fetchAnime(url: string, init: RequestInit = {}): Promise<Response> {
  const parsed = new URL(url);
  const s = session(parsed.origin);
  const headers = new Headers(init.headers);
  headers.set('User-Agent', config.userAgent);
  headers.set('Accept', 'application/json,text/plain,*/*');
  const cookies = cookieHeader(s);
  if (cookies) headers.set('Cookie', cookies);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.upstreamTimeoutMs);
  try {
    const res = await fetch(url, { ...init, headers, signal: ctrl.signal, redirect: 'follow' });
    saveCookies(s, res.headers);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function csrf(origin: string, force = false): Promise<string> {
  const s = session(origin);
  if (!force && s.csrf && s.expires > Date.now()) return s.csrf;
  const res = await fetchAnime(`${origin}/`);
  if (!res.ok) throw new Error(`AnimeUnity homepage ${res.status}`);
  const html = await res.text();
  const token = /<meta name="csrf-token" content="([^"]+)"/.exec(html)?.[1];
  if (!token) throw new Error('AnimeUnity CSRF token missing');
  s.csrf = token;
  s.expires = Date.now() + CSRF_TTL;
  return token;
}

async function post(origin: string, path: string, body: unknown): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await csrf(origin, attempt > 0);
    const res = await fetchAnime(`${origin}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'X-CSRF-TOKEN': token,
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${origin}/`,
      },
      body: JSON.stringify(body),
    });
    if ((res.status === 401 || res.status === 419) && attempt === 0) continue;
    if (!res.ok) throw new Error(`AnimeUnity HTTP ${res.status}`);
    return res.json();
  }
  throw new Error('AnimeUnity session expired');
}

export async function browse(baseUrl: unknown, offset: unknown): Promise<unknown> {
  const origin = base(baseUrl);
  return post(origin, '/archivio/get-animes', {
    title: false, type: false, year: false, order: 'Più visti', status: false,
    genres: false, offset: Number(offset) || 0, dubbed: false, season: false,
  });
}

export async function search(baseUrl: unknown, title: unknown): Promise<unknown> {
  const origin = base(baseUrl);
  const token = await csrf(origin);
  const body = new URLSearchParams({ title: typeof title === 'string' ? title.trim() : '' });
  const res = await fetchAnime(`${origin}/livesearch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-CSRF-TOKEN': token, 'X-Requested-With': 'XMLHttpRequest', Referer: `${origin}/`,
    },
    body,
  });
  if (!res.ok) throw new Error(`AnimeUnity HTTP ${res.status}`);
  return res.json();
}

export async function episodes(baseUrl: unknown, animeId: unknown, start: unknown, end: unknown): Promise<unknown> {
  const origin = base(baseUrl);
  await csrf(origin);
  const res = await fetchAnime(`${origin}/info_api/${Number(animeId)}/1?start_range=${Number(start)}&end_range=${Number(end)}`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });
  if (!res.ok) throw new Error(`AnimeUnity HTTP ${res.status}`);
  const data = await res.json() as { episodes?: unknown[]; episodes_count?: number };
  return { episodes: data.episodes ?? [], total: data.episodes_count ?? data.episodes?.length ?? 0 };
}

export async function embed(baseUrl: unknown, animeId: unknown, episodeId: unknown, slug: unknown): Promise<{ embedUrl: string }> {
  const origin = base(baseUrl);
  await csrf(origin);
  const suffix = typeof slug === 'string' && slug ? `-${slug}` : '';
  const res = await fetchAnime(`${origin}/embed-url/${Number(episodeId)}`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: `${origin}/anime/${Number(animeId)}${suffix}` },
  });
  if (!res.ok) throw new Error(`AnimeUnity HTTP ${res.status}`);
  const embedUrl = (await res.text()).trim();
  const parsed = new URL(embedUrl);
  if (parsed.hostname !== 'vixcloud.co' || !parsed.pathname.startsWith('/embed/')) throw new Error('AnimeUnity returned an invalid player URL');
  return { embedUrl: parsed.href };
}
