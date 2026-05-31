import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response as ExpressResponse, type NextFunction } from 'express';
import { Readable } from 'node:stream';

type MediaType = 'movie' | 'tv';
type ProviderResolveFailureReason = 'not_found' | 'temporarily_unavailable' | 'unreleased';

const PORT = Number(process.env.PORT) || 3000;
const PROVIDER_CATALOG_LINK_SOURCE_URL =
  process.env.PROVIDER_CATALOG_LINK_SOURCE_URL
  || 'https://api.telegra.ph/getPage/Link-Aggiornato-StreamingCommunity-09-29?return_content=true';
const PROVIDER_CATALOG_LOCALE = (process.env.PROVIDER_CATALOG_LOCALE || 'it').trim() || 'it';
const PROXY_DATA_DIR = process.env.PROXY_DATA_DIR || '/data';
const TOKEN_FILE = path.join(PROXY_DATA_DIR, 'auth-token.txt');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));

app.use((req, res, next) => {
  if (req.path !== '/health') {
    refreshHealthCheckInBackground();
  }
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const upstream = typeof res.locals.upstream === 'string' ? ` -> ${res.locals.upstream}` : '';
    const bytes = res.getHeader('content-length');
    const size = typeof bytes === 'string' || typeof bytes === 'number' ? ` ${bytes}b` : '';
    const originIp = getOriginIp(req);
    const health = getTrustedCachedHealthCheck();
    const egressIp = health?.ip ?? '-';
    const masked = health ? health.through_cloudflare && !sameIp(originIp, egressIp) : null;
    // The app tags media requests as 'download' or 'player' (resolve/health
    // calls carry no tag → '-'), so the log shows what each request is for.
    // Sub-resources (segments/keys) and AirPlay requests can't send the header,
    // so we also read the `c` query param the playlist rewriter embeds.
    const client = clientTag(req);
    console.log(
      `[ios-proxy][${client}] ${res.statusCode} ${req.method} ${req.originalUrl} ${duration}ms${size}${upstream}`
      + ` origin_ip=${originIp} egress_ip=${egressIp} through_cf=${formatFlag(health?.through_cloudflare)}`
      + ` masked=${formatFlag(masked)} checked_at=${health?.checked_at ?? '-'}`
    );
  });
  next();
});

const PROVIDER_REQUEST_TIMEOUT_MS = 8000;
const PLAYLIST_FETCH_TIMEOUT_MS = 30000;
const BASE_URL_TTL_MS = 10 * 60 * 1000;
const HEALTH_CACHE_TTL_MS = 60_000;
const STRONG_MATCH_THRESHOLD = 170;
const MIN_CANDIDATE_SCORE = 40;
const MAX_STORED_CANDIDATES = 10;

let cachedBaseURL: { value: string; fetchedAt: number } | null = null;
let latestHealthCheck: ProxyHealthResponse | null = null;
let latestHealthCheckAtMs = 0;
let latestTrustedHealthCheck: ProxyHealthResponse | null = null;
let inFlightHealthCheck: Promise<ProxyHealthResponse> | null = null;
const authToken = ensureAuthToken();

type ProviderResolvedTitle = {
  id: number;
  slug: string | null;
  title: string;
  media_type: MediaType;
};

type ProviderTitleCandidate = {
  provider_title_id: number;
  provider_slug: string | null;
  title: string;
  year: number | null;
  score: number;
  poster_url: string | null;
};

type TitleResolveResponse = {
  resolved: ProviderResolvedTitle | null;
  reason: ProviderResolveFailureReason | null;
  candidates: ProviderTitleCandidate[];
  match_status: 'auto_confirmed' | 'failed' | null;
};

type PlaybackSourcesResponse = {
  sources: Array<{ url: string }>;
  reason: ProviderResolveFailureReason | null;
  message: string | null;
};

type ProviderSearchTitle = {
  id?: number | null;
  slug?: string | null;
  name?: string | null;
  type?: string | null;
  last_air_date?: string | null;
  translations?: Array<{ key?: string | null; value?: string | null }> | null;
};

type ProviderLoadedSeason = {
  id?: number | null;
  number?: number | null;
  episodes?: Array<{
    id?: number | null;
    number?: number | null;
  }> | null;
};

type ProxyHealthResponse = {
  checked_at: number;
  ok: boolean;
  ip: string | null;
  asn_org: string | null;
  warp: boolean;
  colo: string | null;
  country: string | null;
  city: string | null;
  through_cloudflare: boolean;
  provider_catalog_base_url: string | null;
  provider_reachable: boolean;
  vixcloud_reachable: boolean;
  errors: string[];
};

app.get('/health', requireAuth, async (_req, res) => {
  res.json(await runHealthCheck());
});

app.post('/provider/resolve-title', requireAuth, async (req, res) => {
  const body = req.body ?? {};
  const tmdbId = toInt(body.tmdb_id, 1);
  const mediaType = normalizeMediaType(body.media_type);
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const releaseDate = typeof body.release_date === 'string' ? body.release_date : null;

  if (!tmdbId || !mediaType || !title) {
    res.status(400).json({ error: 'invalid_params' });
    return;
  }

  const outcome = await resolveTitle(tmdbId, mediaType, title, releaseDate);
  res.json(outcome);
});

app.post('/provider/resolve-episode', requireAuth, async (req, res) => {
  const body = req.body ?? {};
  const providerTitleId = toInt(body.provider_title_id, 1);
  const season = toInt(body.season, 1);
  const episode = toInt(body.episode, 1);
  const providerSlug = typeof body.provider_slug === 'string' && body.provider_slug.trim()
    ? body.provider_slug.trim()
    : null;

  if (!providerTitleId || !season || !episode) {
    res.status(400).json({ error: 'invalid_params' });
    return;
  }

  const publicBaseURL = requestBaseURL(req);
  const response = await resolveEpisodeSources(providerTitleId, providerSlug, season, episode, publicBaseURL);
  res.json(response);
});

app.post('/provider/resolve-movie', requireAuth, async (req, res) => {
  const body = req.body ?? {};
  const providerTitleId = toInt(body.provider_title_id, 1);
  if (!providerTitleId) {
    res.status(400).json({ error: 'invalid_params' });
    return;
  }

  const publicBaseURL = requestBaseURL(req);
  const response = await resolveMovieSources(providerTitleId, publicBaseURL);
  res.json(response);
});

app.get(/^\/playlist\/(.*)$/i, requireAuth, async (req, res) => {
  const tail = String(req.params[0] ?? '');
  const search = querySuffix(req.url);   // strips our `key` before hitting vixcloud
  const upstreamURL = `https://vixcloud.co/playlist/${tail}${search}`;
  res.locals.upstream = upstreamURL;

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
  // `?q=<height>` (set by the app for forced streaming quality) keeps only the
  // matching video variant in the master, so the player can't ABR to another.
  const q = typeof req.query.q === 'string' ? parseInt(req.query.q, 10) : 0;
  const filtered = q > 0 ? filterMasterToHeight(body, q) : body;
  res.status(upstream.status).send(rewritePlaylist(filtered, authToken, clientTag(req)));
});

app.get(/^\/cdn\/([a-z0-9-]+)\/(.*)$/i, requireAuth, async (req, res) => {
  const host = `${String(req.params[0] ?? '')}.vix-content.net`;
  const tail = String(req.params[1] ?? '');
  await proxyPassthrough(req, res, `https://${host}/${tail}${querySuffix(req.url)}`);
});

app.get(/^\/vixcloud\/(.*)$/i, requireAuth, async (req, res) => {
  const tail = String(req.params[0] ?? '');
  await proxyPassthrough(req, res, `https://vixcloud.co/${tail}${querySuffix(req.url)}`);
});

app.get(/^\/storage\/(.*)$/i, requireAuth, async (req, res) => {
  const tail = String(req.params[0] ?? '');
  await proxyPassthrough(req, res, `https://vixcloud.co/storage/${tail}${querySuffix(req.url)}`);
});

app.get(/^\/jwplayer-(.*)$/i, requireAuth, async (req, res) => {
  const tail = String(req.params[0] ?? '');
  await proxyPassthrough(req, res, `https://vixcloud.co/jwplayer-${tail}${querySuffix(req.url)}`);
});

app.get('/favicon.ico', requireAuth, async (req, res) => {
  await proxyPassthrough(req, res, 'https://vixcloud.co/favicon.ico');
});

async function runHealthCheck(): Promise<ProxyHealthResponse> {
  if (inFlightHealthCheck) {
    return inFlightHealthCheck;
  }

  inFlightHealthCheck = performHealthCheck()
    .then((result) => {
      latestHealthCheck = result;
      latestHealthCheckAtMs = Date.now();
      if (isTrustedHealthCheck(result)) {
        latestTrustedHealthCheck = result;
      } else {
        latestTrustedHealthCheck = null;
      }
      return result;
    })
    .finally(() => {
      inFlightHealthCheck = null;
    });

  return inFlightHealthCheck;
}

function getTrustedCachedHealthCheck(): ProxyHealthResponse | null {
  return latestTrustedHealthCheck;
}

function refreshHealthCheckInBackground(force = false): void {
  const cacheFresh = latestHealthCheckAtMs > 0 && (Date.now() - latestHealthCheckAtMs) < HEALTH_CACHE_TTL_MS;
  if (!force && (cacheFresh || inFlightHealthCheck)) {
    return;
  }

  void runHealthCheck().catch(() => {
    // Best-effort background refresh for request logging only.
  });
}

function startHealthCheckRefreshLoop(intervalMs = HEALTH_CACHE_TTL_MS): void {
  refreshHealthCheckInBackground(true);
  const timer = setInterval(() => {
    refreshHealthCheckInBackground(true);
  }, intervalMs);
  timer.unref?.();
}

async function performHealthCheck(): Promise<ProxyHealthResponse> {
  const errors: string[] = [];
  let warp = false;
  let colo: string | null = null;
  let traceIp: string | null = null;

  try {
    const traceRes = await fetchWithTimeout('https://www.cloudflare.com/cdn-cgi/trace', {}, 5000);
    const trace = parseTrace(await traceRes.text());
    warp = trace.warp === 'on';
    colo = trace.colo ?? null;
    traceIp = trace.ip ?? null;
    if (!warp) {
      errors.push('warp=off');
    }
  } catch {
    errors.push('warp_trace_failed');
  }

  let ipInfo: { ip?: string; org?: string; country?: string; city?: string } = {};
  try {
    const infoRes = await fetchWithTimeout('https://ipinfo.io/json', {}, 5000);
    ipInfo = await infoRes.json() as typeof ipInfo;
  } catch {
    errors.push('ipinfo_failed');
  }

  const baseURL = await providerCatalogBaseURL();
  if (!baseURL) {
    errors.push('catalog_base_unavailable');
  }

  let providerReachable = false;
  if (baseURL) {
    try {
      const url = new URL(`/${PROVIDER_CATALOG_LOCALE}/search`, baseURL);
      url.searchParams.set('q', 'the');
      const response = await fetchWithTimeout(url, {
        headers: {
          accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8'
        },
        referrerPolicy: 'no-referrer'
      }, PROVIDER_REQUEST_TIMEOUT_MS);
      providerReachable = response.ok;
    } catch {
      providerReachable = false;
    }
  }
  if (!providerReachable) {
    errors.push('provider_search_failed');
  }

  let vixcloudReachable = false;
  try {
    const response = await fetchWithTimeout('https://vixcloud.co/', { redirect: 'manual' }, PROVIDER_REQUEST_TIMEOUT_MS);
    vixcloudReachable = response.status >= 200 && response.status < 500;
  } catch {
    vixcloudReachable = false;
  }
  if (!vixcloudReachable) {
    errors.push('vixcloud_unreachable');
  }

  const ip = traceIp ?? ipInfo.ip ?? null;
  const asnOrg = ipInfo.org ?? null;
  const throughCloudflare = warp && (
    (!!asnOrg && /cloudflare/i.test(asnOrg))
    || (!!ip && isCloudflareIp(ip))
  );

  return {
    checked_at: Date.now(),
    ok: warp && providerReachable && vixcloudReachable,
    ip,
    asn_org: asnOrg,
    warp,
    colo,
    country: ipInfo.country ?? null,
    city: ipInfo.city ?? null,
    through_cloudflare: throughCloudflare,
    provider_catalog_base_url: baseURL,
    provider_reachable: providerReachable,
    vixcloud_reachable: vixcloudReachable,
    errors
  };
}

async function resolveTitle(
  tmdbId: number,
  mediaType: MediaType,
  title: string,
  releaseDate: string | null
): Promise<TitleResolveResponse> {
  const query = title.trim();
  if (!query) {
    return { resolved: null, reason: 'not_found', candidates: [], match_status: 'failed' };
  }

  if (isFutureDate(releaseDate)) {
    return { resolved: null, reason: 'unreleased', candidates: [], match_status: 'failed' };
  }

  const titles = await searchTitles(query);
  if (!titles) {
    return { resolved: null, reason: 'temporarily_unavailable', candidates: [], match_status: null };
  }

  const wantedYear = extractYear(releaseDate);
  const ranked = titles
    .filter((entry) => typeof entry.id === 'number' && normalizeMediaType(entry.type) === mediaType)
    .map((entry) => ({ entry, score: scoreCandidate(entry, query, wantedYear) }))
    .sort((a, b) => b.score - a.score);

  const candidates = ranked
    .filter((entry) => entry.score >= MIN_CANDIDATE_SCORE)
    .slice(0, MAX_STORED_CANDIDATES)
    .map((entry) => ({
      provider_title_id: entry.entry.id!,
      provider_slug: entry.entry.slug?.trim() || null,
      title: entry.entry.name?.trim() || query,
      year: extractYear(releaseDateOf(entry.entry)),
      score: entry.score,
      poster_url: null
    }));

  const best = ranked[0];
  if (!best || best.score < MIN_CANDIDATE_SCORE || typeof best.entry.id !== 'number') {
    return { resolved: null, reason: 'not_found', candidates, match_status: 'failed' };
  }

  if (best.score >= STRONG_MATCH_THRESHOLD) {
    return {
      resolved: {
        id: best.entry.id,
        slug: best.entry.slug?.trim() || null,
        title: best.entry.name?.trim() || query,
        media_type: mediaType
      },
      reason: null,
      candidates,
      match_status: 'auto_confirmed'
    };
  }

  return { resolved: null, reason: 'not_found', candidates, match_status: 'failed' };
}

async function resolveEpisodeSources(
  providerTitleId: number,
  providerSlug: string | null,
  seasonNumber: number,
  episodeNumber: number,
  publicBaseURL: string
): Promise<PlaybackSourcesResponse> {
  const loadedSeason = await fetchSeason(providerTitleId, providerSlug, seasonNumber);
  const episodes = loadedSeason?.episodes ?? [];
  const match = episodes.find((entry) => entry.number === episodeNumber && typeof entry.id === 'number');
  if (!match?.id) {
    return {
      sources: [],
      reason: episodes.length === 0 ? 'temporarily_unavailable' : 'not_found',
      message: unavailableMessage(episodes.length === 0 ? 'temporarily_unavailable' : 'not_found')
    };
  }

  const embedURL = await fetchEmbedURL(providerTitleId, match.id);
  if (!embedURL) {
    return {
      sources: [],
      reason: 'temporarily_unavailable',
      message: unavailableMessage('temporarily_unavailable')
    };
  }

  return resolvePlaybackSources(embedURL, publicBaseURL);
}

async function resolveMovieSources(
  providerTitleId: number,
  publicBaseURL: string
): Promise<PlaybackSourcesResponse> {
  const embedURL = await fetchEmbedURL(providerTitleId);
  if (!embedURL) {
    return {
      sources: [],
      reason: 'temporarily_unavailable',
      message: unavailableMessage('temporarily_unavailable')
    };
  }

  return resolvePlaybackSources(embedURL, publicBaseURL);
}

async function resolvePlaybackSources(embedURL: string, publicBaseURL: string): Promise<PlaybackSourcesResponse> {
  const html = await fetchText(embedURL, {
    accept: 'text/html,application/xhtml+xml,*/*'
  }, 15000);
  if (!html) {
    return {
      sources: [],
      reason: 'temporarily_unavailable',
      message: 'Impossibile contattare il proxy video.'
    };
  }

  const urls = buildPlaylistURLs(html)
    .map((url) => proxiedPlaylistURL(publicBaseURL, url))
    .filter((url): url is string => Boolean(url));

  if (urls.length === 0) {
    return {
      sources: [],
      reason: 'temporarily_unavailable',
      message: 'Stream non trovato nella pagina del player.'
    };
  }

  return {
    sources: urls.map((url) => ({ url })),
    reason: null,
    message: null
  };
}

async function searchTitles(query: string): Promise<ProviderSearchTitle[] | null> {
  const baseURL = await providerCatalogBaseURL();
  if (!baseURL) {
    return null;
  }

  const url = new URL(`/${PROVIDER_CATALOG_LOCALE}/search`, baseURL);
  url.searchParams.set('q', query);

  const response = await fetchWithTimeout(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8'
    },
    referrerPolicy: 'no-referrer'
  }, PROVIDER_REQUEST_TIMEOUT_MS).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const data = await response.json().catch(() => null) as {
      props?: { titles?: ProviderSearchTitle[] | { data?: ProviderSearchTitle[] } };
    } | null;
    return extractSearchTitles(data);
  }

  const html = await response.text().catch(() => '');
  return extractSearchTitles(parseInertiaPage(html));
}

async function fetchSeason(
  providerTitleId: number,
  providerSlug: string | null,
  seasonNumber: number
): Promise<ProviderLoadedSeason | null> {
  const slug = providerSlug?.trim() || '';
  if (!slug) {
    return null;
  }

  const baseURL = await providerCatalogBaseURL();
  if (!baseURL) {
    return null;
  }

  const url = new URL(`/${PROVIDER_CATALOG_LOCALE}/titles/${providerTitleId}-${slug}/season-${seasonNumber}`, baseURL);
  const response = await fetchWithTimeout(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8'
    },
    referrerPolicy: 'no-referrer'
  }, PROVIDER_REQUEST_TIMEOUT_MS).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const data = await response.json().catch(() => null) as {
      props?: { loadedSeason?: ProviderLoadedSeason };
    } | null;
    return data?.props?.loadedSeason ?? null;
  }

  const html = await response.text().catch(() => '');
  const data = parseInertiaPage(html) as { props?: { loadedSeason?: ProviderLoadedSeason } } | null;
  return data?.props?.loadedSeason ?? null;
}

async function fetchEmbedURL(providerTitleId: number, episodeId?: number): Promise<string | null> {
  const baseURL = await providerCatalogBaseURL();
  if (!baseURL) {
    return null;
  }

  const url = new URL(`/${PROVIDER_CATALOG_LOCALE}/iframe/${providerTitleId}`, baseURL);
  if (episodeId) {
    url.searchParams.set('episode_id', String(episodeId));
    url.searchParams.set('next_episode', '1');
  }

  const html = await fetchText(url.toString(), {
    accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8'
  }, PROVIDER_REQUEST_TIMEOUT_MS);
  if (!html) {
    return null;
  }

  const raw = firstMatch(html, /<iframe[^>]+src="([^"]+)"/i)
    ?? firstMatch(html, /<iframe[^>]+src='([^']+)'/i);
  if (!raw) {
    return null;
  }

  const embedURL = decodeHtmlEntities(raw.trim());
  try {
    const parsed = new URL(embedURL, baseURL);
    if (parsed.hostname !== 'vixcloud.co' || !parsed.pathname.startsWith('/embed/')) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

async function providerCatalogBaseURL(): Promise<string | null> {
  if (cachedBaseURL && (Date.now() - cachedBaseURL.fetchedAt) < BASE_URL_TTL_MS) {
    return cachedBaseURL.value;
  }

  const response = await fetchWithTimeout(PROVIDER_CATALOG_LINK_SOURCE_URL, {
    headers: {
      accept: 'application/json'
    }
  }, PROVIDER_REQUEST_TIMEOUT_MS).catch(() => null);

  if (!response?.ok) {
    return cachedBaseURL?.value ?? null;
  }

  const payload = await response.json().catch(() => null) as {
    result?: { content?: unknown[] };
  } | null;
  const href = firstHref(payload?.result?.content);
  const normalized = href ? normalizeBaseURL(href) : null;
  if (!normalized) {
    return cachedBaseURL?.value ?? null;
  }

  cachedBaseURL = { value: normalized, fetchedAt: Date.now() };
  return normalized;
}

async function proxyPassthrough(
  req: Request,
  res: ExpressResponse,
  upstreamURL: string
): Promise<void> {
  res.locals.upstream = upstreamURL;
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
  // through this proxy. Otherwise the client — notably the offline downloader,
  // which fetches *every* track rather than the single variant AVPlayer
  // streams — would hit the CDN directly and require its own WARP egress.
  const contentType = (upstream.headers.get('content-type') ?? '').toLowerCase();
  const isPlaylist = contentType.includes('mpegurl')
    || contentType.includes('m3u8')
    || /\.m3u8(?:$|\?)/i.test(upstreamURL);
  if (isPlaylist) {
    const body = await upstream.text();
    copyProxyHeaders(upstream, res, true);
    res.status(upstream.status).send(rewritePlaylist(body, authToken, clientTag(req)));
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

/// Keep only ONE video `#EXT-X-STREAM-INF` variant in a master playlist: the
/// highest RESOLUTION height ≤ `maxHeight`, else the lowest (all taller), else
/// (no RESOLUTION info) the highest BANDWIDTH. Non-master playlists (no
/// STREAM-INF) pass through unchanged. This truly forces streaming quality —
/// the player has no other variant to adapt to.
function filterMasterToHeight(body: string, maxHeight: number): string {
  const lines = body.split('\n');
  type Block = { infIndex: number; uriIndex: number; bandwidth: number; height: number };
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith('#EXT-X-STREAM-INF')) continue;
    const inf = lines[i];
    const bw = parseInt(inf.match(/BANDWIDTH=(\d+)/i)?.[1] ?? '0', 10);
    const height = parseInt(inf.match(/RESOLUTION=\d+x(\d+)/i)?.[1] ?? '0', 10);
    // The URI is the next non-empty, non-comment line.
    let k = i + 1;
    while (k < lines.length && (lines[k].trim() === '' || lines[k].trim().startsWith('#'))) k++;
    if (k < lines.length) blocks.push({ infIndex: i, uriIndex: k, bandwidth: bw, height });
  }
  if (blocks.length <= 1) return body;

  const withHeight = blocks.filter((b) => b.height > 0);
  let chosen: Block | undefined;
  if (withHeight.length > 0) {
    const eligible = withHeight.filter((b) => b.height <= maxHeight);
    chosen = (eligible.length ? eligible : withHeight)
      .sort((a, b) => (eligible.length ? b.height - a.height : a.height - b.height))[0];
  } else {
    chosen = blocks.slice().sort((a, b) => b.bandwidth - a.bandwidth)[0];
  }
  if (!chosen) return body;

  const drop = new Set<number>();
  for (const b of blocks) {
    if (b.uriIndex === chosen.uriIndex) continue;
    drop.add(b.infIndex);
    drop.add(b.uriIndex);
  }
  return lines.filter((_, idx) => !drop.has(idx)).join('\n');
}

function rewritePlaylist(body: string, token: string, client: string = '-'): string {
  // Step 1: rewrite absolute upstream URLs to proxy-relative paths.
  const rewritten = body
    .replace(/https?:\/\/([a-z0-9-]+)\.vix-content\.net(\/[^\s"']*)/gi, '/cdn/$1$2')
    .replace(/\/\/([a-z0-9-]+)\.vix-content\.net(\/[^\s"']*)/gi, '/cdn/$1$2')
    .replace(/https?:\/\/vixcloud\.co(\/(?:playlist|storage)\/[^\s"']*|\/jwplayer-[^\s"']*|\/favicon\.ico)/gi, '$1')
    .replace(/\/\/vixcloud\.co(\/(?:playlist|storage)\/[^\s"']*|\/jwplayer-[^\s"']*|\/favicon\.ico)/gi, '$1')
    .replace(/https?:\/\/vixcloud\.co(\/[^\s"']*)/gi, '/vixcloud$1')
    .replace(/\/\/vixcloud\.co(\/[^\s"']*)/gi, '/vixcloud$1');

  // Step 2: append our `?key=` (auth) and `&c=` (client tag for logging) to
  // EVERY proxy-relative URL (sub-playlists, segments, and the EXT-X-KEY/
  // enc.key, which vixcloud often references with a root-relative URL we
  // didn't touch above). AirPlay receivers send no headers, so both must
  // travel in each sub-resource URL. Skip any that already carry the key.
  const key = encodeURIComponent(token);
  const suffix = client !== '-' ? `key=${key}&c=${encodeURIComponent(client)}` : `key=${key}`;
  return rewritten.replace(
    /\/(?:cdn|vixcloud|storage|playlist)\/[^\s"']*/gi,
    (m: string) => (/[?&]key=/.test(m) ? m : (m.includes('?') ? `${m}&${suffix}` : `${m}?${suffix}`))
  );
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

function proxiedPlaylistURL(publicBaseURL: string, upstreamURL: URL): string | null {
  if (upstreamURL.hostname !== 'vixcloud.co' || !upstreamURL.pathname.startsWith('/playlist/')) {
    return null;
  }
  return `${publicBaseURL}${upstreamURL.pathname}${upstreamURL.search}`;
}

function extractSearchTitles(data: { props?: { titles?: ProviderSearchTitle[] | { data?: ProviderSearchTitle[] } } } | null): ProviderSearchTitle[] {
  const titles = data?.props?.titles;
  if (Array.isArray(titles)) {
    return titles;
  }
  if (titles && Array.isArray((titles as { data?: ProviderSearchTitle[] }).data)) {
    return (titles as { data?: ProviderSearchTitle[] }).data ?? [];
  }
  return [];
}

function parseInertiaPage(html: string): Record<string, unknown> | null {
  const marker = 'data-page=';
  const start = html.indexOf(marker);
  if (start < 0) {
    return null;
  }

  const quote = html[start + marker.length];
  if (quote !== '"' && quote !== '\'') {
    return null;
  }

  let i = start + marker.length + 1;
  let value = '';
  while (i < html.length) {
    const ch = html[i];
    if (ch === quote) {
      break;
    }
    value += ch;
    i += 1;
  }

  if (!value) {
    return null;
  }

  const decoded = decodeHtmlEntities(value);
  try {
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function scoreCandidate(candidate: ProviderSearchTitle, wantedTitle: string, wantedYear: number | null): number {
  const candidateTitle = candidate.name?.trim();
  if (!candidateTitle) {
    return 0;
  }

  const wantedNorm = normalizeTitle(wantedTitle);
  const candidateNorm = normalizeTitle(candidateTitle);
  if (!wantedNorm || !candidateNorm) {
    return 0;
  }

  let score = tokenOverlapScore(wantedNorm, candidateNorm);
  if (candidateNorm === wantedNorm) {
    score += 120;
  } else if (candidateNorm.startsWith(wantedNorm) || wantedNorm.startsWith(candidateNorm)) {
    score += 70;
  } else if (candidateNorm.includes(wantedNorm) || wantedNorm.includes(candidateNorm)) {
    score += 35;
  }

  const candidateYear = extractYear(releaseDateOf(candidate));
  if (wantedYear && candidateYear) {
    if (candidateYear === wantedYear) {
      score += 35;
    } else if (Math.abs(candidateYear - wantedYear) === 1) {
      score += 10;
    } else {
      score -= 20;
    }
  }

  return score;
}

function tokenOverlapScore(a: string, b: string): number {
  const aTokens = new Set(a.split(' ').filter(Boolean));
  const bTokens = new Set(b.split(' ').filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      overlap += 1;
    }
  }
  return Math.round(overlap / Math.max(aTokens.size, bTokens.size) * 100);
}

function normalizeTitle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeMediaType(value: unknown): MediaType | null {
  return value === 'movie' || value === 'tv' ? value : null;
}

function releaseDateOf(title: ProviderSearchTitle): string | null {
  const translated = title.translations?.find((entry) => entry.key === 'release_date' || entry.key === 'last_air_date')?.value;
  return translated?.trim() || title.last_air_date?.trim() || null;
}

function extractYear(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const match = value.match(/\b(\d{4})\b/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function isFutureDate(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > Date.now();
}

function normalizeBaseURL(href: string): string | null {
  try {
    const url = new URL(href);
    const normalized = url.toString();
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  } catch {
    return null;
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&apos;|&#039;|&#39;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function firstHref(nodes: unknown[] | undefined): string | null {
  if (!Array.isArray(nodes)) {
    return null;
  }

  for (const node of nodes) {
    if (node && typeof node === 'object') {
      const href = (node as { attrs?: { href?: unknown } }).attrs?.href;
      if (typeof href === 'string' && href.trim()) {
        return href.trim();
      }
      const childHref = firstHref((node as { children?: unknown[] }).children);
      if (childHref) {
        return childHref;
      }
    }
  }

  return null;
}

function requestBaseURL(req: Request): string {
  const proto = headerValue(req.headers['x-forwarded-proto'], req.protocol).split(',')[0].trim();
  return `${proto}://${req.get('host')}`;
}

function querySuffix(url: string): string {
  const start = url.indexOf('?');
  if (start < 0) return '';
  // Strip only OUR params (key/c/q) while keeping every other param byte-for-
  // byte: vixcloud signs `token`/`expires`, so re-encoding via URLSearchParams
  // (which canonicalizes +, /, =, %xx) could invalidate the CDN signature.
  const internal = new Set(['key', 'c', 'q']);
  const kept = url.slice(start + 1)
    .split('&')
    .filter((pair) => pair !== '' && !internal.has(pair.split('=')[0]));
  return kept.length ? `?${kept.join('&')}` : '';
}

function firstMatch(value: string, regex: RegExp): string | null {
  const match = value.match(regex);
  return match?.[1] ?? null;
}

function extractAny(value: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = firstMatch(value, pattern);
    if (match) {
      return match;
    }
  }
  return null;
}

function parseTrace(text: string): Record<string, string> {
  return text
    .split(/\r?\n/)
    .map((line) => line.split('='))
    .filter((parts): parts is [string, string] => parts.length === 2)
    .reduce<Record<string, string>>((acc, [key, value]) => {
      acc[key] = value;
      return acc;
    }, {});
}

const CLOUDFLARE_IPV4_PREFIXES = [
  '173.245.48.', '103.21.244.', '103.22.200.', '103.31.4.',
  '141.101.64.', '108.162.192.', '190.93.240.', '188.114.96.',
  '197.234.240.', '198.41.128.', '162.158.', '172.64.', '172.65.',
  '172.66.', '172.67.', '172.68.', '172.69.', '172.70.', '172.71.',
  '131.0.72.', '104.16.', '104.17.', '104.18.', '104.19.', '104.20.',
  '104.21.', '104.22.', '104.23.', '104.24.', '104.25.', '104.26.',
  '104.27.', '104.28.'
];

const CLOUDFLARE_IPV6_PREFIXES = [
  '2400:cb00:', '2606:4700:', '2803:f800:', '2405:b500:',
  '2405:8100:', '2c0f:f248:', '2a06:98c0:',
  '2a09:bac0:', '2a09:bac1:', '2a09:bac2:', '2a09:bac3:',
  '2a09:bac4:', '2a09:bac5:', '2a09:bac6:', '2a09:bac7:'
];

function isCloudflareIp(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower.includes(':')) {
    return CLOUDFLARE_IPV6_PREFIXES.some((prefix) => lower.startsWith(prefix));
  }
  return CLOUDFLARE_IPV4_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function isTrustedHealthCheck(result: ProxyHealthResponse): boolean {
  return !result.errors.includes('warp_trace_failed') && !!result.ip;
}

function unavailableMessage(reason: ProviderResolveFailureReason): string {
  switch (reason) {
    case 'temporarily_unavailable':
      return 'Riproduzione temporaneamente non disponibile';
    case 'unreleased':
      return 'Non ancora disponibile';
    default:
      return 'Titolo non disponibile';
  }
}

function toInt(value: unknown, min: number): number | null {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n >= min ? n : null;
}

function headerValue(value: string | string[] | undefined, fallback: string): string {
  if (Array.isArray(value)) {
    return value[0] ?? fallback;
  }
  return value ?? fallback;
}

/// The request's client tag for logging: the `X-Streamo-Client` header, or the
/// `c` query param the playlist rewriter embeds (so segments/keys and AirPlay
/// — which can't send the header — are still attributed), else '-'.
function clientTag(req: Request): string {
  const header = headerValue(req.headers['x-streamo-client'], '').trim();
  if (header) return header;
  const q = typeof req.query.c === 'string' ? req.query.c.trim() : '';
  return q || '-';
}

function activeSortValue(value: boolean | undefined): number {
  return value ? 0 : 1;
}

function getOriginIp(req: Request): string {
  return firstHeaderValue(req.headers['cf-connecting-ip'])
    ?? firstForwardedIp(req.headers['x-forwarded-for'])
    ?? firstHeaderValue(req.headers['x-real-ip'])
    ?? normalizeIp(req.ip)
    ?? normalizeIp(req.socket.remoteAddress)
    ?? '-';
}

function firstForwardedIp(value: string | string[] | undefined): string | null {
  const header = firstHeaderValue(value);
  if (!header) {
    return null;
  }

  const first = header.split(',')[0]?.trim();
  return normalizeIp(first);
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return normalizeIp(value[0]);
  }
  return normalizeIp(value);
}

function normalizeIp(value: string | undefined | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sameIp(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function formatFlag(value: boolean | null | undefined): string {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return 'unknown';
}

async function fetchText(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<string | null> {
  const response = await fetchWithTimeout(url, {
    headers,
    referrerPolicy: 'no-referrer'
  }, timeoutMs).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  return response.text().catch(() => null);
}

async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = 8000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function requireAuth(req: Request, res: ExpressResponse, next: NextFunction): void {
  // `?key=` query fallback so AirPlay receivers — which fetch the stream URL
  // with NO custom headers — can still authenticate. (We use `key`, not
  // `token`, because `token` is vixcloud's own CDN parameter.)
  const queryKey = typeof req.query.key === 'string' ? req.query.key.trim() : '';
  const candidate = bearerToken(req.headers.authorization)
    || headerValue(req.headers['x-proxy-token'], '').trim()
    || queryKey;
  if (candidate && timingSafeEqual(candidate, authToken)) {
    next();
    return;
  }
  res.status(401).json({ error: 'unauthorized' });
}

function bearerToken(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function ensureAuthToken(): string {
  fs.mkdirSync(PROXY_DATA_DIR, { recursive: true });
  if (fs.existsSync(TOKEN_FILE)) {
    const existing = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (existing) {
      console.log(`[ios-proxy] auth token loaded from ${TOKEN_FILE}`);
      return existing;
    }
  }

  const token = crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(TOKEN_FILE, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(`[ios-proxy] auth token generated and saved to ${TOKEN_FILE}`);
  return token;
}

app.listen(PORT, '0.0.0.0', () => {
  startHealthCheckRefreshLoop();
  console.log(`iOS proxy listening on ${PORT}`);
});
