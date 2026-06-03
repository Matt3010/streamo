// Streamo Stremio addon — fully standalone Jellyfin integration.
//
// Speaks the Stremio addon protocol (manifest/catalog/meta/stream) on its own
// `sc:` id namespace, scrapes the StreamingCommunity catalog directly
// (catalog.ts) and resolves + proxies vixcloud HLS itself (playback.ts).
// No TMDB, no dependency on the iOS app or its proxy.
//
// Id format:
//   movie  meta/stream id:  sc:1994-matrix
//   series meta id:         sc:3-breaking-bad-reazioni-collaterali
//   series stream id:       sc:3-breaking-bad-reazioni-collaterali:1:2  (season 1, episode 2)

import express from 'express';
import { authToken, requireKey } from './auth.js';
import {
  type TitleDetail,
  catalogBaseURL,
  searchCatalog,
  seasonEpisodes,
  titleDetail
} from './catalog.js';
import { proxyPassthrough, proxyPlaylist, resolveEpisodeSources, resolveMovieSources } from './playback.js';
import { downloadPageHTML, ffmpegAssetDirs } from './download.js';
import { type ExternalId, tmdbEnabled } from './tmdb.js';
import { resolveExternalId } from './resolve.js';
import { querySuffix, redactAuthKey, requestBaseURL, toInt } from './util.js';

const PORT = Number(process.env.PORT) || 7000;
// Base URL players use to reach this addon's HLS proxy. MUST be reachable
// from every Jellyfin client (LAN IP, not localhost / docker hostname).
// Falls back to the request's own host when unset.
const PUBLIC_URL = (process.env.ADDON_PUBLIC_URL || '').trim().replace(/\/$/, '');
const META_CACHE_TTL_MS = 30 * 60 * 1000;

const app = express();
app.set('trust proxy', 1);

app.use((req, res, next) => {
  // Stremio clients and Gelato live on other origins.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[addon] ${res.statusCode} ${req.method} ${redactAuthKey(req.originalUrl)} ${Date.now() - start}ms`);
  });
  next();
});

// --- Manifest ------------------------------------------------------------------

// `sc:` = our own catalog (direct Stremio use); `tt`/`tmdb:` = external ids
// that Gelato/AIOStreams query streams with (only when TMDB is configured).
const ID_PREFIXES = tmdbEnabled() ? ['sc:', 'tt', 'tmdb:'] : ['sc:'];

const MANIFEST = {
  id: 'community.streamo',
  version: '2.0.0',
  name: 'Streamo',
  description: 'StreamingCommunity: ricerca, metadati e stream (standalone)',
  // Resources as full objects (name/types/idPrefixes) — the verbose form.
  // Gelato's manifest parser rejects the short string form (`"stream"`).
  resources: [
    { name: 'catalog', types: ['movie', 'series'], idPrefixes: ID_PREFIXES },
    { name: 'meta', types: ['movie', 'series'], idPrefixes: ID_PREFIXES },
    { name: 'stream', types: ['movie', 'series'], idPrefixes: ID_PREFIXES }
  ],
  types: ['movie', 'series'],
  idPrefixes: ID_PREFIXES,
  catalogs: [
    {
      type: 'movie',
      id: 'streamo-search',
      name: 'StreamingCommunity',
      extra: [{ name: 'search', isRequired: true }]
    },
    {
      type: 'series',
      id: 'streamo-search',
      name: 'StreamingCommunity',
      extra: [{ name: 'search', isRequired: true }]
    }
  ],
  behaviorHints: { configurable: false, configurationRequired: false }
};

app.get('/manifest.json', (_req, res) => {
  res.json(MANIFEST);
});

app.get('/health', async (_req, res) => {
  const baseURL = await catalogBaseURL();
  res.json({ ok: Boolean(baseURL), catalog_base_url: baseURL });
});

// --- Catalog (search) -------------------------------------------------------------

app.get(['/catalog/:type/streamo-search/:extra.json', '/catalog/:type/streamo-search.json'], async (req, res) => {
  const type = stremioType(req.params.type);
  const query = extraValue(req.params.extra, 'search');
  if (!type || !query) {
    res.json({ metas: [] });
    return;
  }

  const titles = await searchCatalog(query);
  const wanted = type === 'movie' ? 'movie' : 'tv';
  const metas = (titles ?? [])
    .filter((title) => title.type === wanted)
    .map((title) => ({
      id: `sc:${title.id}-${title.slug}`,
      type,
      name: title.name,
      poster: title.posterURL ?? undefined,
      background: title.backgroundURL ?? undefined,
      description: title.plot ?? undefined,
      releaseInfo: title.year ? String(title.year) : undefined,
      imdbRating: title.score ?? undefined
    }));

  res.json({ metas });
});

// --- Meta --------------------------------------------------------------------------

type CachedMeta = { value: Record<string, unknown> | null; expiresAt: number };
const metaCache = new Map<string, CachedMeta>();

app.get('/meta/:type/:id.json', async (req, res) => {
  const type = stremioType(req.params.type);
  const parsed = parseScId(req.params.id);
  if (!type || !parsed) {
    res.json({ meta: null });
    return;
  }

  const cacheKey = `${type}:${parsed.titleId}`;
  const cached = metaCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.json({ meta: cached.value });
    return;
  }

  const meta = await buildMeta(type, parsed.titleId, parsed.slug);
  metaCache.set(cacheKey, { value: meta, expiresAt: Date.now() + META_CACHE_TTL_MS });
  res.json({ meta });
});

async function buildMeta(
  type: 'movie' | 'series',
  titleId: number,
  slug: string
): Promise<Record<string, unknown> | null> {
  const detail = await titleDetail(titleId, slug);
  if (!detail) {
    return null;
  }

  const metaId = `sc:${detail.id}-${detail.slug}`;
  const meta: Record<string, unknown> = {
    id: metaId,
    type,
    name: detail.name,
    description: detail.plot ?? undefined,
    poster: detail.posterURL ?? undefined,
    background: detail.backgroundURL ?? undefined,
    logo: detail.logoURL ?? undefined,
    releaseInfo: detail.year ? String(detail.year) : undefined,
    imdbRating: detail.score ?? undefined,
    runtime: detail.runtime ? `${detail.runtime} min` : undefined,
    genres: detail.genres.length ? detail.genres : undefined,
    // SC carries the imdb id on the title page; exposing it lets Stremio
    // clients and Gelato enrich/dedupe against other metadata sources.
    imdb_id: detail.imdbId ?? undefined
  };

  if (type === 'series') {
    meta.videos = await buildSeriesVideos(metaId, detail);
  }

  return meta;
}

async function buildSeriesVideos(metaId: string, detail: TitleDetail): Promise<Array<Record<string, unknown>>> {
  const seasons = await Promise.all(
    detail.seasons.map(async (season) => ({
      number: season.number,
      episodes: await seasonEpisodes(detail.id, detail.slug, season.number) ?? []
    }))
  );

  return seasons.flatMap((season) =>
    season.episodes.map((episode) => ({
      id: `${metaId}:${season.number}:${episode.number}`,
      title: episode.name ?? `Episodio ${episode.number}`,
      season: season.number,
      episode: episode.number,
      overview: episode.plot ?? undefined,
      thumbnail: episode.coverURL ?? undefined
    }))
  );
}

// --- Stream --------------------------------------------------------------------------

app.get('/stream/:type/:id.json', async (req, res) => {
  const type = stremioType(req.params.type);
  if (!type) {
    res.json({ streams: [] });
    return;
  }

  // Accepts our own `sc:{id}-{slug}` ids AND the external ids
  // (`tt…`, `tmdb:…`) Gelato/AIOStreams query streams with. External ids are
  // resolved to an SC title via TMDB + tmdb_id verification.
  const target = await resolveStreamTarget(req.params.id, type);
  if (!target) {
    res.json({ streams: [] });
    return;
  }

  const publicBaseURL = PUBLIC_URL || requestBaseURL(req);
  const result = type === 'movie'
    ? await resolveMovieSources(target.titleId, publicBaseURL)
    : target.season && target.episode
      ? await resolveEpisodeSources(target.titleId, target.slug, target.season, target.episode, publicBaseURL)
      : { sources: [], reason: 'not_found' as const };

  res.json({
    streams: result.sources.map((source) => ({
      name: 'Streamo',
      title: 'StreamingCommunity (HLS)',
      url: source.url
    }))
  });
});

type StreamTarget = { titleId: number; slug: string; season: number | null; episode: number | null };

/// Turns any supported stream id into a concrete SC title + optional episode.
async function resolveStreamTarget(rawId: string, type: 'movie' | 'series'): Promise<StreamTarget | null> {
  const sc = parseScId(rawId);
  if (sc) {
    return sc;
  }

  const external = parseExternalId(rawId);
  if (!external) {
    return null;
  }

  const mediaType = type === 'movie' ? 'movie' : 'tv';
  const ref = await resolveExternalId(external.id, mediaType);
  if (!ref) {
    return null;
  }
  return { titleId: ref.id, slug: ref.slug, season: external.season, episode: external.episode };
}

// --- Offline download (client-side mux via ffmpeg.wasm) ------------------------------------

// Static ffmpeg.wasm bundles served to the browser (no external CDN needed).
const ffmpegDirs = ffmpegAssetDirs();
app.use('/dl-assets/ffmpeg', express.static(ffmpegDirs.ffmpeg));
app.use('/dl-assets/core', express.static(ffmpegDirs.core));

app.get('/download/:type/:id', (req, res) => {
  const type = stremioType(req.params.type);
  if (!type) {
    res.status(400).send('tipo non valido');
    return;
  }
  res.type('html').send(downloadPageHTML(type, req.params.id));
});

// --- HLS proxy routes (key-protected) ---------------------------------------------------

app.get(/^\/playlist\/(.*)$/i, requireKey, async (req, res) => {
  await proxyPlaylist(req, res, String(req.params[0] ?? ''));
});

app.get(/^\/cdn\/([a-z0-9-]+)\/(.*)$/i, requireKey, async (req, res) => {
  const host = `${String(req.params[0] ?? '')}.vix-content.net`;
  const tail = String(req.params[1] ?? '');
  await proxyPassthrough(req, res, `https://${host}/${tail}${querySuffix(req.url)}`);
});

app.get(/^\/vixcloud\/(.*)$/i, requireKey, async (req, res) => {
  const tail = String(req.params[0] ?? '');
  await proxyPassthrough(req, res, `https://vixcloud.co/${tail}${querySuffix(req.url)}`);
});

app.get(/^\/storage\/(.*)$/i, requireKey, async (req, res) => {
  const tail = String(req.params[0] ?? '');
  await proxyPassthrough(req, res, `https://vixcloud.co/storage/${tail}${querySuffix(req.url)}`);
});

app.get(/^\/jwplayer-(.*)$/i, requireKey, async (req, res) => {
  const tail = String(req.params[0] ?? '');
  await proxyPassthrough(req, res, `https://vixcloud.co/jwplayer-${tail}${querySuffix(req.url)}`);
});

// --- Helpers --------------------------------------------------------------------------

function stremioType(value: string): 'movie' | 'series' | null {
  return value === 'movie' || value === 'series' ? value : null;
}

/// Parses `sc:{id}-{slug}` with optional `:{season}:{episode}` suffix.
function parseScId(raw: string): { titleId: number; slug: string; season: number | null; episode: number | null } | null {
  const decoded = decodeURIComponent(String(raw ?? '').trim());
  if (!decoded.startsWith('sc:')) {
    return null;
  }

  const parts = decoded.slice(3).split(':');
  const idSlug = parts[0].match(/^(\d+)-(.+)$/);
  if (!idSlug) {
    return null;
  }

  const titleId = toInt(idSlug[1]);
  const slug = idSlug[2].trim();
  if (!titleId || !slug) {
    return null;
  }

  return {
    titleId,
    slug,
    season: toInt(parts[1]),
    episode: toInt(parts[2])
  };
}

/// Parses external Stremio ids: imdb `tt0903747` or `tmdb:1396`, with optional
/// `:{season}:{episode}` suffix for series.
function parseExternalId(raw: string): { id: ExternalId; season: number | null; episode: number | null } | null {
  const decoded = decodeURIComponent(String(raw ?? '').trim());
  const parts = decoded.split(':');

  if (/^tt\d+$/.test(parts[0])) {
    return { id: { kind: 'imdb', id: parts[0] }, season: toInt(parts[1]), episode: toInt(parts[2]) };
  }

  if (parts[0] === 'tmdb') {
    const tmdbId = toInt(parts[1]);
    if (!tmdbId) {
      return null;
    }
    return { id: { kind: 'tmdb', id: tmdbId }, season: toInt(parts[2]), episode: toInt(parts[3]) };
  }

  return null;
}

/// Stremio catalog `extra` path segment is querystring-encoded: `search=foo&skip=0`.
function extraValue(extra: string | undefined, name: string): string | null {
  if (!extra) {
    return null;
  }
  const value = new URLSearchParams(decodeURIComponent(extra)).get(name);
  return value?.trim() || null;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[addon] Streamo addon listening on ${PORT}`);
  console.log(`[addon] public URL: ${PUBLIC_URL || '(derived from request host)'}`);
  console.log(`[addon] proxy auth key: ${authToken.slice(0, 6)}…`);
});
