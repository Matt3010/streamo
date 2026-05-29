import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { Readable } from 'node:stream';
const PORT = Number(process.env.PORT) || 3000;
const PROVIDER_CATALOG_LINK_SOURCE_URL = process.env.PROVIDER_CATALOG_LINK_SOURCE_URL
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
        console.log(`[ios-proxy] ${res.statusCode} ${req.method} ${req.originalUrl} ${duration}ms${size}${upstream}`
            + ` origin_ip=${originIp} egress_ip=${egressIp} through_cf=${formatFlag(health?.through_cloudflare)}`
            + ` masked=${formatFlag(masked)} checked_at=${health?.checked_at ?? '-'}`);
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
let cachedBaseURL = null;
let latestHealthCheck = null;
let latestHealthCheckAtMs = 0;
let latestTrustedHealthCheck = null;
let inFlightHealthCheck = null;
const authToken = ensureAuthToken();
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
    const queryStart = req.url.indexOf('?');
    const search = queryStart >= 0 ? req.url.slice(queryStart) : '';
    const upstreamURL = `https://vixcloud.co/playlist/${tail}${search}`;
    res.locals.upstream = upstreamURL;
    let upstream;
    try {
        upstream = await fetchWithTimeout(upstreamURL, {
            headers: {
                accept: headerValue(req.headers.accept, '*/*'),
                'accept-encoding': 'identity',
                origin: 'https://vixcloud.co'
            },
            referrerPolicy: 'no-referrer'
        }, PLAYLIST_FETCH_TIMEOUT_MS);
    }
    catch (error) {
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
async function runHealthCheck() {
    if (inFlightHealthCheck) {
        return inFlightHealthCheck;
    }
    inFlightHealthCheck = performHealthCheck()
        .then((result) => {
        latestHealthCheck = result;
        latestHealthCheckAtMs = Date.now();
        if (isTrustedHealthCheck(result)) {
            latestTrustedHealthCheck = result;
        }
        else {
            latestTrustedHealthCheck = null;
        }
        return result;
    })
        .finally(() => {
        inFlightHealthCheck = null;
    });
    return inFlightHealthCheck;
}
function getTrustedCachedHealthCheck() {
    return latestTrustedHealthCheck;
}
function refreshHealthCheckInBackground(force = false) {
    const cacheFresh = latestHealthCheckAtMs > 0 && (Date.now() - latestHealthCheckAtMs) < HEALTH_CACHE_TTL_MS;
    if (!force && (cacheFresh || inFlightHealthCheck)) {
        return;
    }
    void runHealthCheck().catch(() => {
        // Best-effort background refresh for request logging only.
    });
}
function startHealthCheckRefreshLoop(intervalMs = HEALTH_CACHE_TTL_MS) {
    refreshHealthCheckInBackground(true);
    const timer = setInterval(() => {
        refreshHealthCheckInBackground(true);
    }, intervalMs);
    timer.unref?.();
}
async function performHealthCheck() {
    const errors = [];
    let warp = false;
    let colo = null;
    let traceIp = null;
    try {
        const traceRes = await fetchWithTimeout('https://www.cloudflare.com/cdn-cgi/trace', {}, 5000);
        const trace = parseTrace(await traceRes.text());
        warp = trace.warp === 'on';
        colo = trace.colo ?? null;
        traceIp = trace.ip ?? null;
        if (!warp) {
            errors.push('warp=off');
        }
    }
    catch {
        errors.push('warp_trace_failed');
    }
    let ipInfo = {};
    try {
        const infoRes = await fetchWithTimeout('https://ipinfo.io/json', {}, 5000);
        ipInfo = await infoRes.json();
    }
    catch {
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
        }
        catch {
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
    }
    catch {
        vixcloudReachable = false;
    }
    if (!vixcloudReachable) {
        errors.push('vixcloud_unreachable');
    }
    const ip = traceIp ?? ipInfo.ip ?? null;
    const asnOrg = ipInfo.org ?? null;
    const throughCloudflare = warp && ((!!asnOrg && /cloudflare/i.test(asnOrg))
        || (!!ip && isCloudflareIp(ip)));
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
async function resolveTitle(tmdbId, mediaType, title, releaseDate) {
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
        provider_title_id: entry.entry.id,
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
async function resolveEpisodeSources(providerTitleId, providerSlug, seasonNumber, episodeNumber, publicBaseURL) {
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
async function resolveMovieSources(providerTitleId, publicBaseURL) {
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
async function resolvePlaybackSources(embedURL, publicBaseURL) {
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
        .filter((url) => Boolean(url));
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
async function searchTitles(query) {
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
        const data = await response.json().catch(() => null);
        return extractSearchTitles(data);
    }
    const html = await response.text().catch(() => '');
    return extractSearchTitles(parseInertiaPage(html));
}
async function fetchSeason(providerTitleId, providerSlug, seasonNumber) {
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
        const data = await response.json().catch(() => null);
        return data?.props?.loadedSeason ?? null;
    }
    const html = await response.text().catch(() => '');
    const data = parseInertiaPage(html);
    return data?.props?.loadedSeason ?? null;
}
async function fetchEmbedURL(providerTitleId, episodeId) {
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
    }
    catch {
        return null;
    }
}
async function providerCatalogBaseURL() {
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
    const payload = await response.json().catch(() => null);
    const href = firstHref(payload?.result?.content);
    const normalized = href ? normalizeBaseURL(href) : null;
    if (!normalized) {
        return cachedBaseURL?.value ?? null;
    }
    cachedBaseURL = { value: normalized, fetchedAt: Date.now() };
    return normalized;
}
async function proxyPassthrough(req, res, upstreamURL) {
    res.locals.upstream = upstreamURL;
    let upstream;
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
    }
    catch (error) {
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
        res.status(upstream.status).send(rewritePlaylist(body));
        return;
    }
    await forwardResponse(upstream, res);
}
async function forwardResponse(upstream, res) {
    copyProxyHeaders(upstream, res, false);
    res.status(upstream.status);
    if (!upstream.body) {
        const body = Buffer.from(await upstream.arrayBuffer());
        res.send(body);
        return;
    }
    Readable.fromWeb(upstream.body).pipe(res);
}
function copyProxyHeaders(upstream, res, isPlaylist) {
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
function rewritePlaylist(body) {
    return body
        .replace(/https?:\/\/([a-z0-9-]+)\.vix-content\.net(\/[^\s"']*)/gi, '/cdn/$1$2')
        .replace(/\/\/([a-z0-9-]+)\.vix-content\.net(\/[^\s"']*)/gi, '/cdn/$1$2')
        .replace(/https?:\/\/vixcloud\.co(\/(?:playlist|storage)\/[^\s"']*|\/jwplayer-[^\s"']*|\/favicon\.ico)/gi, '$1')
        .replace(/\/\/vixcloud\.co(\/(?:playlist|storage)\/[^\s"']*|\/jwplayer-[^\s"']*|\/favicon\.ico)/gi, '$1')
        .replace(/https?:\/\/vixcloud\.co(\/[^\s"']*)/gi, '/vixcloud$1')
        .replace(/\/\/vixcloud\.co(\/[^\s"']*)/gi, '/vixcloud$1');
}
function buildPlaylistURLs(html) {
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
    const bases = [];
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
    const seen = new Set();
    return bases
        .map((base) => withPlaylistParams(base, token, expires, canFhd))
        .filter((url) => Boolean(url))
        .filter((url) => {
        const key = url.toString();
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}
function withPlaylistParams(base, token, expires, canFhd) {
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
    }
    catch {
        return null;
    }
}
function parseStreams(html) {
    const raw = firstMatch(html, /window\.streams\s*=\s*(\[.*?\])/is);
    if (!raw) {
        return [];
    }
    try {
        return JSON.parse(raw) ?? [];
    }
    catch {
        return [];
    }
}
function proxiedPlaylistURL(publicBaseURL, upstreamURL) {
    if (upstreamURL.hostname !== 'vixcloud.co' || !upstreamURL.pathname.startsWith('/playlist/')) {
        return null;
    }
    return `${publicBaseURL}${upstreamURL.pathname}${upstreamURL.search}`;
}
function extractSearchTitles(data) {
    const titles = data?.props?.titles;
    if (Array.isArray(titles)) {
        return titles;
    }
    if (titles && Array.isArray(titles.data)) {
        return titles.data ?? [];
    }
    return [];
}
function parseInertiaPage(html) {
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
        return JSON.parse(decoded);
    }
    catch {
        return null;
    }
}
function scoreCandidate(candidate, wantedTitle, wantedYear) {
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
    }
    else if (candidateNorm.startsWith(wantedNorm) || wantedNorm.startsWith(candidateNorm)) {
        score += 70;
    }
    else if (candidateNorm.includes(wantedNorm) || wantedNorm.includes(candidateNorm)) {
        score += 35;
    }
    const candidateYear = extractYear(releaseDateOf(candidate));
    if (wantedYear && candidateYear) {
        if (candidateYear === wantedYear) {
            score += 35;
        }
        else if (Math.abs(candidateYear - wantedYear) === 1) {
            score += 10;
        }
        else {
            score -= 20;
        }
    }
    return score;
}
function tokenOverlapScore(a, b) {
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
function normalizeTitle(value) {
    return value
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}
function normalizeMediaType(value) {
    return value === 'movie' || value === 'tv' ? value : null;
}
function releaseDateOf(title) {
    const translated = title.translations?.find((entry) => entry.key === 'release_date' || entry.key === 'last_air_date')?.value;
    return translated?.trim() || title.last_air_date?.trim() || null;
}
function extractYear(value) {
    if (!value) {
        return null;
    }
    const match = value.match(/\b(\d{4})\b/);
    return match ? Number.parseInt(match[1], 10) : null;
}
function isFutureDate(value) {
    if (!value) {
        return false;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed > Date.now();
}
function normalizeBaseURL(href) {
    try {
        const url = new URL(href);
        const normalized = url.toString();
        return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
    }
    catch {
        return null;
    }
}
function decodeHtmlEntities(value) {
    return value
        .replace(/&quot;|&#34;/g, '"')
        .replace(/&apos;|&#039;|&#39;/g, '\'')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}
function firstHref(nodes) {
    if (!Array.isArray(nodes)) {
        return null;
    }
    for (const node of nodes) {
        if (node && typeof node === 'object') {
            const href = node.attrs?.href;
            if (typeof href === 'string' && href.trim()) {
                return href.trim();
            }
            const childHref = firstHref(node.children);
            if (childHref) {
                return childHref;
            }
        }
    }
    return null;
}
function requestBaseURL(req) {
    const proto = headerValue(req.headers['x-forwarded-proto'], req.protocol).split(',')[0].trim();
    return `${proto}://${req.get('host')}`;
}
function querySuffix(url) {
    const start = url.indexOf('?');
    return start >= 0 ? url.slice(start) : '';
}
function firstMatch(value, regex) {
    const match = value.match(regex);
    return match?.[1] ?? null;
}
function extractAny(value, patterns) {
    for (const pattern of patterns) {
        const match = firstMatch(value, pattern);
        if (match) {
            return match;
        }
    }
    return null;
}
function parseTrace(text) {
    return text
        .split(/\r?\n/)
        .map((line) => line.split('='))
        .filter((parts) => parts.length === 2)
        .reduce((acc, [key, value]) => {
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
function isCloudflareIp(ip) {
    const lower = ip.toLowerCase();
    if (lower.includes(':')) {
        return CLOUDFLARE_IPV6_PREFIXES.some((prefix) => lower.startsWith(prefix));
    }
    return CLOUDFLARE_IPV4_PREFIXES.some((prefix) => lower.startsWith(prefix));
}
function isTrustedHealthCheck(result) {
    return !result.errors.includes('warp_trace_failed') && !!result.ip;
}
function unavailableMessage(reason) {
    switch (reason) {
        case 'temporarily_unavailable':
            return 'Riproduzione temporaneamente non disponibile';
        case 'unreleased':
            return 'Non ancora disponibile';
        default:
            return 'Titolo non disponibile';
    }
}
function toInt(value, min) {
    const n = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(n) && n >= min ? n : null;
}
function headerValue(value, fallback) {
    if (Array.isArray(value)) {
        return value[0] ?? fallback;
    }
    return value ?? fallback;
}
function activeSortValue(value) {
    return value ? 0 : 1;
}
function getOriginIp(req) {
    return firstHeaderValue(req.headers['cf-connecting-ip'])
        ?? firstForwardedIp(req.headers['x-forwarded-for'])
        ?? firstHeaderValue(req.headers['x-real-ip'])
        ?? normalizeIp(req.ip)
        ?? normalizeIp(req.socket.remoteAddress)
        ?? '-';
}
function firstForwardedIp(value) {
    const header = firstHeaderValue(value);
    if (!header) {
        return null;
    }
    const first = header.split(',')[0]?.trim();
    return normalizeIp(first);
}
function firstHeaderValue(value) {
    if (Array.isArray(value)) {
        return normalizeIp(value[0]);
    }
    return normalizeIp(value);
}
function normalizeIp(value) {
    if (!value) {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function sameIp(left, right) {
    return left.toLowerCase() === right.toLowerCase();
}
function formatFlag(value) {
    if (value === true)
        return 'yes';
    if (value === false)
        return 'no';
    return 'unknown';
}
async function fetchText(url, headers, timeoutMs) {
    const response = await fetchWithTimeout(url, {
        headers,
        referrerPolicy: 'no-referrer'
    }, timeoutMs).catch(() => null);
    if (!response?.ok) {
        return null;
    }
    return response.text().catch(() => null);
}
async function fetchWithTimeout(input, init = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(input, { ...init, signal: controller.signal });
    }
    finally {
        clearTimeout(timer);
    }
}
function requireAuth(req, res, next) {
    const candidate = bearerToken(req.headers.authorization) || headerValue(req.headers['x-proxy-token'], '').trim();
    if (candidate && timingSafeEqual(candidate, authToken)) {
        next();
        return;
    }
    res.status(401).json({ error: 'unauthorized' });
}
function bearerToken(value) {
    if (!value) {
        return null;
    }
    const match = value.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || null;
}
function timingSafeEqual(a, b) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) {
        return false;
    }
    return crypto.timingSafeEqual(left, right);
}
function ensureAuthToken() {
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
