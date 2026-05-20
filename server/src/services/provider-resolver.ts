import type { MediaType } from '../../../shared/types';
import { kdb } from '../db';
import {
  PROVIDER_CATALOG_BASE_URL_OVERRIDE,
  PROVIDER_CATALOG_LINK_SOURCE_URL,
  PROVIDER_LINK_SOURCE_CACHE_TTL_SECONDS,
  PROVIDER_CATALOG_LOCALE,
  PROVIDER_RESOLVE_CACHE_TTL,
  PROVIDER_RESOLVER_DEBUG
} from '../config';
import { providerResolveLogger } from './provider-resolve-logs';

interface ResolveArgs {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  releaseDate?: string | null;
}

export interface ProviderResolvedTitle {
  provider: 'streamingcommunity';
  id: number;
  slug: string | null;
  title: string;
  mediaType: MediaType;
}

export interface ProviderResolvedEpisode {
  episodeId: number;
  embedUrl: string | null;
}

export interface ProviderResolvedMovie {
  embedUrl: string | null;
}

type MatchStatus = 'auto_confirmed' | 'manual_confirmed' | 'pending_review' | 'failed';

interface ProviderSearchPage {
  props?: {
    titles?: ProviderSearchTitle[] | { data?: ProviderSearchTitle[] };
  };
}

interface ProviderTitlePage {
  props?: {
    title?: {
      seasons?: ProviderSeasonSummary[];
    };
    loadedSeason?: ProviderLoadedSeason | null;
  };
}

interface ProviderSearchTitle {
  id?: number;
  slug?: string | null;
  name?: string | null;
  type?: string | null;
  last_air_date?: string | null;
  translations?: Array<{
    key?: string | null;
    value?: string | null;
  }>;
}

type CacheEntry = {
  expiresAt: number;
  value: ProviderResolvedTitle | null;
};

interface ProviderSeasonSummary {
  id?: number;
  number?: number;
  episodes_count?: number;
}

interface ProviderLoadedSeason {
  id?: number;
  number?: number;
  episodes?: ProviderEpisode[];
}

interface ProviderEpisode {
  id?: number;
  number?: number;
  scws_id?: number | null;
  season_id?: number | null;
}

interface TelegraphPageNode {
  tag?: string;
  attrs?: {
    href?: string;
    [key: string]: unknown;
  };
  children?: Array<TelegraphPageNode | string>;
}

interface TelegraphPageResponse {
  ok?: boolean;
  result?: {
    content?: TelegraphPageNode[];
  };
}

type EpisodeCacheEntry = {
  expiresAt: number;
  value: ProviderLoadedSeason | null;
};

type ProviderCatalogBaseUrlCacheEntry = {
  expiresAt: number;
  value: string;
};

interface StoredProviderMappingRow {
  provider: string;
  provider_id: number | null;
  provider_slug: string | null;
  resolved_title: string | null;
  match_status: MatchStatus;
  last_checked_at: number;
}

const resolveCache = new Map<string, CacheEntry>();
const seasonCache = new Map<string, EpisodeCacheEntry>();
let providerCatalogBaseUrlCache: ProviderCatalogBaseUrlCacheEntry | null = null;
const PROVIDER_NAME = 'streamingcommunity';
const PROVIDER_CATALOG_BASE_URL_META_KEY = 'provider_catalog_base_url';
const STRONG_MATCH_THRESHOLD = 170;
const REVIEW_MATCH_THRESHOLD = 120;

export async function resolveProviderTitle(args: ResolveArgs): Promise<ProviderResolvedTitle | null> {
  const cacheKey = `${args.mediaType}:${args.tmdbId}`;
  const now = Date.now();
  const cached = resolveCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const cachedMapping = await readStoredMapping(args, now);
  if (cachedMapping !== undefined) {
    cacheResolve(cacheKey, cachedMapping, now);
    return cachedMapping;
  }

  const query = args.title.trim();
  if (!query) {
    await upsertMapping(args, {
      matchStatus: 'failed',
      matchConfidence: 0,
      failureReason: 'missing_title',
      candidate: null
    }, now);
    cacheResolve(cacheKey, null, now);
    return null;
  }

  const page = await fetchProviderSearchPage(query);
  if (!page) {
    return null;
  }

  const titles = extractProviderTitles(page);
  logCandidateSummary(args, titles);
  const best = pickBestMatch(titles, args);
  const { match, persistence } = finalizeMatch(best);
  providerResolveLogger.info('title match decision', {
    query: args.title,
    mediaType: args.mediaType,
    tmdbId: args.tmdbId,
    releaseDate: args.releaseDate ?? null,
    bestScore: best?.score ?? null,
    selected: match
      ? { id: match.id, slug: match.slug, title: match.title, mediaType: match.mediaType }
      : null,
    persistence
  });
  await upsertMapping(args, persistence, now);
  cacheResolve(cacheKey, match, now);
  return match;
}

export async function resolveProviderEpisode(args: {
  providerTitleId: number;
  providerSlug: string | null;
  seasonNumber: number;
  episodeNumber: number;
}): Promise<ProviderResolvedEpisode | null> {
  const season = await fetchProviderSeason(args.providerTitleId, args.providerSlug, args.seasonNumber);
  const episodes = season?.episodes;
  if (!episodes?.length) {
    providerResolveLogger.warn('episode resolve decision', {
      providerTitleId: args.providerTitleId,
      providerSlug: args.providerSlug,
      seasonNumber: args.seasonNumber,
      episodeNumber: args.episodeNumber,
      resolved: null,
      reason: 'missing_season_payload'
    });
    return null;
  }

  const match = episodes.find((episode) => episode.number === args.episodeNumber && episode.id);
  if (!match?.id) {
    providerResolveLogger.warn('episode resolve decision', {
      providerTitleId: args.providerTitleId,
      providerSlug: args.providerSlug,
      seasonNumber: args.seasonNumber,
      episodeNumber: args.episodeNumber,
      resolved: null,
      availableEpisodes: episodes
        .map((episode) => ({ id: episode.id ?? null, number: episode.number ?? null }))
        .slice(0, 20),
      reason: 'episode_not_found'
    });
    return null;
  }

  const embedUrl = await fetchProviderEmbedUrl(args.providerTitleId, match.id);

  providerResolveLogger.info('episode resolve decision', {
    providerTitleId: args.providerTitleId,
    providerSlug: args.providerSlug,
    seasonNumber: args.seasonNumber,
    episodeNumber: args.episodeNumber,
    resolved: { episodeId: match.id, embedUrl }
  });

  return { episodeId: match.id, embedUrl };
}

export async function resolveProviderMovie(args: {
  providerTitleId: number;
}): Promise<ProviderResolvedMovie | null> {
  const embedUrl = await fetchProviderEmbedUrl(args.providerTitleId);
  providerResolveLogger.info('movie resolve decision', {
    providerTitleId: args.providerTitleId,
    resolved: embedUrl ? { embedUrl } : null
  });

  if (!embedUrl) {
    return null;
  }

  return { embedUrl };
}

function cacheResolve(key: string, value: ProviderResolvedTitle | null, now: number): void {
  resolveCache.set(key, {
    value,
    expiresAt: now + (PROVIDER_RESOLVE_CACHE_TTL * 1000)
  });
}

async function fetchProviderSearchPage(query: string): Promise<ProviderSearchPage | null> {
  const providerCatalogBaseUrl = await getProviderCatalogBaseUrl();
  if (!providerCatalogBaseUrl) {
    providerResolveLogger.error('provider catalog base url unavailable', {
      sourceUrl: PROVIDER_CATALOG_LINK_SOURCE_URL
    });
    return null;
  }
  const url = new URL(`/${PROVIDER_CATALOG_LOCALE}/search`, providerCatalogBaseUrl);
  url.searchParams.set('q', query);

  let res: Response;
  try {
    res = await fetch(url, {
      referrerPolicy: 'no-referrer',
      headers: {
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8'
      }
    });
  } catch {
    providerResolveLogger.error('search request failed', { query, url: url.toString() });
    return null;
  }

  debug('search upstream response', {
    query,
    url: url.toString(),
    status: res.status,
    contentType: res.headers.get('content-type') ?? ''
  });

  if (!res.ok) return null;

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      const page = await res.json() as ProviderSearchPage;
      logProviderPayloadShape(query, page, 'json');
      return page;
    } catch {
      providerResolveLogger.error('search payload invalid', { query, url: url.toString() });
      return null;
    }
  }

  const html = await res.text();
  const page = parseInertiaPageFromHtml(html);
  logProviderPayloadShape(query, page, 'html');
  return page;
}

function parseInertiaPageFromHtml(html: string): ProviderSearchPage | null {
  const marker = 'data-page=';
  const idx = html.indexOf(marker);
  if (idx < 0) return null;

  const after = html.slice(idx + marker.length);
  const quote = after[0];
  if (quote !== '"' && quote !== '\'') return null;

  let value = '';
  for (let i = 1; i < after.length; i += 1) {
    const ch = after[i];
    if (ch === quote) break;
    value += ch;
  }

  if (!value) return null;

  try {
    return JSON.parse(decodeHtmlEntities(value)) as ProviderSearchPage;
  } catch {
    return null;
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&#039;/g, '\'')
    .replace(/&#39;/g, '\'')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractProviderTitles(page: ProviderSearchPage | null): ProviderSearchTitle[] {
  const titles = page?.props?.titles;
  if (Array.isArray(titles)) return titles;
  if (Array.isArray(titles?.data)) return titles.data;
  return [];
}

function extractLoadedSeason(page: ProviderTitlePage | null): ProviderLoadedSeason | null {
  const loadedSeason = page?.props?.loadedSeason;
  if (!loadedSeason || typeof loadedSeason !== 'object') return null;
  return loadedSeason;
}

function pickBestMatch(
  titles: ProviderSearchTitle[],
  args: ResolveArgs
): { candidate: ProviderResolvedTitle; score: number } | null {
  const wantedYear = extractYear(args.releaseDate ?? null);
  const candidates = titles
    .filter((title) => title.id && normalizeProviderType(title.type) === args.mediaType)
    .map((title) => ({
      title,
      score: scoreCandidate(title, args.title, wantedYear)
    }))
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best || best.score < 40 || !best.title.id) return null;

  return {
    score: best.score,
    candidate: {
      provider: 'streamingcommunity',
      id: best.title.id,
      slug: best.title.slug ?? null,
      title: best.title.name?.trim() || args.title,
      mediaType: args.mediaType
    }
  };
}

function scoreCandidate(
  candidate: ProviderSearchTitle,
  wantedTitle: string,
  wantedYear: number | null
): number {
  const candidateTitle = candidate.name?.trim() ?? '';
  if (!candidateTitle) return 0;

  const wantedNorm = normalizeTitle(wantedTitle);
  const candidateNorm = normalizeTitle(candidateTitle);
  if (!wantedNorm || !candidateNorm) return 0;

  let score = tokenOverlapScore(wantedNorm, candidateNorm);

  if (candidateNorm === wantedNorm) score += 120;
  else if (candidateNorm.startsWith(wantedNorm) || wantedNorm.startsWith(candidateNorm)) score += 70;
  else if (candidateNorm.includes(wantedNorm) || wantedNorm.includes(candidateNorm)) score += 35;

  const candidateYear = extractYear(getProviderReleaseDate(candidate));
  if (wantedYear !== null && candidateYear !== null) {
    if (candidateYear === wantedYear) score += 35;
    else if (Math.abs(candidateYear - wantedYear) === 1) score += 10;
    else score -= 20;
  }

  return score;
}

function tokenOverlapScore(a: string, b: string): number {
  const aTokens = new Set(a.split(' ').filter(Boolean));
  const bTokens = new Set(b.split(' ').filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }

  const total = Math.max(aTokens.size, bTokens.size);
  return Math.round((overlap / total) * 100);
}

function normalizeTitle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeProviderType(value: string | null | undefined): MediaType | null {
  if (value === 'movie' || value === 'tv') return value;
  return null;
}

function getProviderReleaseDate(title: ProviderSearchTitle): string | null {
  const translationValue = title.translations?.find((entry) => (
    entry.key === 'release_date' || entry.key === 'last_air_date'
  ))?.value;

  return translationValue ?? title.last_air_date ?? null;
}

function extractYear(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/\b(\d{4})\b/);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isInteger(year) ? year : null;
}

function debug(event: string, context: unknown): void {
  if (!PROVIDER_RESOLVER_DEBUG) {
    return;
  }

  providerResolveLogger.info(event, context);
}

function logProviderPayloadShape(
  query: string,
  page: ProviderSearchPage | null,
  source: 'json' | 'html'
): void {
  const titles = extractProviderTitles(page);
  const sample = titles.slice(0, 3).map((title) => ({
    id: title.id ?? null,
    slug: title.slug ?? null,
    name: title.name ?? null,
    type: title.type ?? null,
    last_air_date: title.last_air_date ?? null,
    translationKeys: (title.translations ?? []).map((entry) => entry.key ?? null).slice(0, 8)
  }));

  debug('search results payload', {
    query,
    source,
    titlesCount: titles.length,
    sample
  });
}

function logCandidateSummary(args: ResolveArgs, titles: ProviderSearchTitle[]): void {
  const wantedYear = extractYear(args.releaseDate ?? null);
  const ranked = titles
    .filter((title) => title.id)
    .map((title) => ({
      id: title.id ?? null,
      title: title.name ?? null,
      type: normalizeProviderType(title.type),
      year: extractYear(getProviderReleaseDate(title)),
      score: scoreCandidate(title, args.title, wantedYear)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  debug('search candidate ranking', {
    query: args.title,
    mediaType: args.mediaType,
    tmdbId: args.tmdbId,
    wantedYear,
    top: ranked
  });
}

function finalizeMatch(best: { candidate: ProviderResolvedTitle; score: number } | null): {
  match: ProviderResolvedTitle | null;
  persistence: {
    matchStatus: MatchStatus;
    matchConfidence: number;
    failureReason: string | null;
    candidate: ProviderResolvedTitle | null;
  };
} {
  if (!best) {
    return {
      match: null,
      persistence: {
        matchStatus: 'failed',
        matchConfidence: 0,
        failureReason: 'no_match',
        candidate: null
      }
    };
  }

  if (best.score >= STRONG_MATCH_THRESHOLD) {
    return {
      match: best.candidate,
      persistence: {
        matchStatus: 'auto_confirmed',
        matchConfidence: best.score,
        failureReason: null,
        candidate: best.candidate
      }
    };
  }

  if (best.score >= REVIEW_MATCH_THRESHOLD) {
    return {
      // Keep a soft-review marker in persistence, but don't block playback for
      // titles that already have a concrete provider id candidate.
      match: best.candidate,
      persistence: {
        matchStatus: 'pending_review',
        matchConfidence: best.score,
        failureReason: 'low_confidence',
        candidate: best.candidate
      }
    };
  }

  return {
    match: null,
    persistence: {
      matchStatus: 'failed',
      matchConfidence: best.score,
      failureReason: 'low_confidence',
      candidate: best.candidate
    }
  };
}

async function readStoredMapping(
  args: ResolveArgs,
  nowMs: number
): Promise<ProviderResolvedTitle | null | undefined> {
  const row = await kdb
    .selectFrom('provider_title_map')
    .select([
      'provider',
      'provider_id',
      'provider_slug',
      'resolved_title',
      'match_status',
      'last_checked_at'
    ])
    .where('tmdb_id', '=', args.tmdbId)
    .where('media_type', '=', args.mediaType)
    .where('provider', '=', PROVIDER_NAME)
    .executeTakeFirst() as StoredProviderMappingRow | undefined;

  if (!row) return undefined;

  // Once we have a confirmed provider title id, treat it as durable and
  // never go back to the provider's search endpoint just to "re-find" it.
  // Slug / season / embed lookups may still happen later, but title-id
  // resolution itself is locked to the persisted mapping.
  const confirmed = toConfirmedStoredMapping(row, args);
  if (confirmed !== undefined) {
    if (confirmed) return confirmed;
    return null;
  }

  const freshUntilMs = (row.last_checked_at * 1000) + (PROVIDER_RESOLVE_CACHE_TTL * 1000);
  if (row.match_status === 'pending_review') {
    if (freshUntilMs > nowMs) {
      return toStoredMappingCandidate(row, args);
    }
    return undefined;
  }

  if (freshUntilMs > nowMs) {
    return null;
  }

  return undefined;
}

function toConfirmedStoredMapping(
  row: StoredProviderMappingRow,
  args: ResolveArgs
): ProviderResolvedTitle | null | undefined {
  if (row.match_status !== 'manual_confirmed' && row.match_status !== 'auto_confirmed') {
    return undefined;
  }

  if (!row.provider_id) {
    return null;
  }

  return {
    provider: 'streamingcommunity',
    id: row.provider_id,
    slug: row.provider_slug,
    title: row.resolved_title ?? args.title,
    mediaType: args.mediaType
  };
}

function toStoredMappingCandidate(
  row: Pick<StoredProviderMappingRow, 'provider_id' | 'provider_slug' | 'resolved_title'>,
  args: ResolveArgs
): ProviderResolvedTitle | null {
  if (!row.provider_id) {
    return null;
  }

  return {
    provider: 'streamingcommunity',
    id: row.provider_id,
    slug: row.provider_slug,
    title: row.resolved_title ?? args.title,
    mediaType: args.mediaType
  };
}

async function upsertMapping(
  args: ResolveArgs,
  result: {
    matchStatus: MatchStatus;
    matchConfidence: number;
    failureReason: string | null;
    candidate: ProviderResolvedTitle | null;
  },
  nowMs: number
): Promise<void> {
  const now = Math.floor(nowMs / 1000);
  const releaseYear = extractYear(args.releaseDate ?? null);
  const resolvedAt = result.matchStatus === 'auto_confirmed' || result.matchStatus === 'manual_confirmed'
    ? now
    : null;

  await kdb
    .insertInto('provider_title_map')
    .values({
      tmdb_id: args.tmdbId,
      media_type: args.mediaType,
      provider: PROVIDER_NAME,
      provider_id: result.candidate?.id ?? null,
      provider_slug: result.candidate?.slug ?? null,
      match_status: result.matchStatus,
      match_confidence: result.matchConfidence,
      source_title: args.title,
      resolved_title: result.candidate?.title ?? null,
      release_year: releaseYear,
      failure_reason: result.failureReason,
      resolved_at: resolvedAt,
      last_checked_at: now
    })
    .onConflict((oc) => oc.columns(['tmdb_id', 'media_type', 'provider']).doUpdateSet({
      provider_id: result.candidate?.id ?? null,
      provider_slug: result.candidate?.slug ?? null,
      match_status: result.matchStatus,
      match_confidence: result.matchConfidence,
      source_title: args.title,
      resolved_title: result.candidate?.title ?? null,
      release_year: releaseYear,
      failure_reason: result.failureReason,
      resolved_at: resolvedAt,
      last_checked_at: now
    }))
    .execute();
}

async function fetchProviderSeason(
  providerTitleId: number,
  providerSlug: string | null,
  seasonNumber: number
): Promise<ProviderLoadedSeason | null> {
  const slug = providerSlug?.trim() || await fetchProviderSlug(providerTitleId);
  if (!slug) {
    providerResolveLogger.error('season slug missing', {
      providerTitleId,
      seasonNumber
    });
    return null;
  }

  const cacheKey = `${providerTitleId}:${slug}:${seasonNumber}`;
  const now = Date.now();
  const cached = seasonCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const providerCatalogBaseUrl = await getProviderCatalogBaseUrl();
  if (!providerCatalogBaseUrl) {
    providerResolveLogger.error('provider catalog base url unavailable', {
      sourceUrl: PROVIDER_CATALOG_LINK_SOURCE_URL,
      providerTitleId,
      seasonNumber
    });
    return null;
  }
  const url = new URL(
    `/${PROVIDER_CATALOG_LOCALE}/titles/${providerTitleId}-${slug}/season-${seasonNumber}`,
    providerCatalogBaseUrl
  );

  let res: Response;
  try {
    res = await fetch(url, {
      referrerPolicy: 'no-referrer',
      headers: {
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8'
      }
    });
  } catch {
    providerResolveLogger.error('season request failed', {
      providerTitleId,
      slug,
      seasonNumber,
      url: url.toString()
    });
    return null;
  }

  debug('season page upstream response', {
    providerTitleId,
    slug,
    seasonNumber,
    url: url.toString(),
    status: res.status,
    contentType: res.headers.get('content-type') ?? ''
  });

  if (!res.ok) return null;

  const contentType = res.headers.get('content-type') ?? '';
  let page: ProviderTitlePage | null = null;
  if (contentType.includes('application/json')) {
    try {
      page = await res.json() as ProviderTitlePage;
    } catch {
      providerResolveLogger.error('season payload invalid', {
        providerTitleId,
        slug,
        seasonNumber,
        url: url.toString()
      });
      return null;
    }
  } else {
    const html = await res.text();
    page = parseInertiaPageFromHtml(html) as ProviderTitlePage | null;
  }

  const loadedSeason = extractLoadedSeason(page);
  debug('season episodes payload', {
    providerTitleId,
    slug,
    seasonNumber,
    loadedSeasonNumber: loadedSeason?.number ?? null,
    episodesCount: loadedSeason?.episodes?.length ?? 0,
    sampleEpisodes: (loadedSeason?.episodes ?? [])
      .slice(0, 5)
      .map((episode) => ({
        id: episode.id ?? null,
        number: episode.number ?? null,
        scwsId: episode.scws_id ?? null
      }))
  });

  seasonCache.set(cacheKey, {
    value: loadedSeason,
    expiresAt: now + (PROVIDER_RESOLVE_CACHE_TTL * 1000)
  });

  return loadedSeason;
}

async function fetchProviderSlug(providerTitleId: number): Promise<string | null> {
  const row = await kdb
    .selectFrom('provider_title_map')
    .select('provider_slug')
    .where('provider', '=', PROVIDER_NAME)
    .where('provider_id', '=', providerTitleId)
    .where('provider_slug', 'is not', null)
    .orderBy('resolved_at', 'desc')
    .orderBy('last_checked_at', 'desc')
    .executeTakeFirst();

  return row?.provider_slug?.trim() || null;
}

async function fetchProviderEmbedUrl(
  providerTitleId: number,
  episodeId?: number
): Promise<string | null> {
  const providerCatalogBaseUrl = await getProviderCatalogBaseUrl();
  if (!providerCatalogBaseUrl) {
    providerResolveLogger.error('provider catalog base url unavailable', {
      sourceUrl: PROVIDER_CATALOG_LINK_SOURCE_URL,
      providerTitleId,
      episodeId: episodeId ?? null
    });
    return null;
  }
  const url = new URL(
    `/${PROVIDER_CATALOG_LOCALE}/iframe/${providerTitleId}`,
    providerCatalogBaseUrl
  );
  if (episodeId) {
    url.searchParams.set('episode_id', String(episodeId));
    url.searchParams.set('next_episode', '1');
  }

  let res: Response;
  try {
    res = await fetch(url, {
      referrerPolicy: 'no-referrer',
      headers: {
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8'
      }
    });
  } catch {
    providerResolveLogger.error('embed request failed', {
      providerTitleId,
      episodeId: episodeId ?? null,
      url: url.toString()
    });
    return null;
  }

  debug('embed page upstream response', {
    providerTitleId,
    episodeId: episodeId ?? null,
    url: url.toString(),
    status: res.status,
    contentType: res.headers.get('content-type') ?? ''
  });

  if (!res.ok) return null;

  const html = await res.text();
  const match = html.match(/<iframe[^>]+src="([^"]+)"/i) || html.match(/<iframe[^>]+src='([^']+)'/i);
  if (!match?.[1]) {
    providerResolveLogger.error('embed iframe src missing', {
      providerTitleId,
      episodeId: episodeId ?? null
    });
    return null;
  }

  const embedUrl = decodeHtmlEntities(match[1].trim());
  try {
    const parsed = new URL(embedUrl, providerCatalogBaseUrl);
    const isVixEmbed = parsed.hostname === 'vixcloud.co' && parsed.pathname.startsWith('/embed/');
    if (!isVixEmbed) {
    providerResolveLogger.error('embed host unexpected', {
        providerTitleId,
        episodeId: episodeId ?? null,
        embedUrl
      });
      return null;
    }

    const relative = `/embed${parsed.pathname.slice('/embed'.length)}${parsed.search}`;
    providerResolveLogger.info('embed url resolved', {
      providerTitleId,
      episodeId: episodeId ?? null,
      embedUrl: relative
    });
    return relative;
  } catch {
    providerResolveLogger.error('embed url invalid', {
      providerTitleId,
      episodeId: episodeId ?? null,
      embedUrl
    });
    return null;
  }
}

async function getProviderCatalogBaseUrl(): Promise<string | null> {
  const now = Date.now();
  if (providerCatalogBaseUrlCache && providerCatalogBaseUrlCache.expiresAt > now) {
    return providerCatalogBaseUrlCache.value;
  }

  const resolved = await fetchProviderCatalogBaseUrlFromTelegraph();
  if (resolved) {
    providerCatalogBaseUrlCache = {
      value: resolved,
      expiresAt: now + (PROVIDER_LINK_SOURCE_CACHE_TTL_SECONDS * 1000)
    };
    try {
      await persistProviderCatalogBaseUrl(resolved);
    } catch {
      providerResolveLogger.warn('provider catalog base url persist failed', {
        key: PROVIDER_CATALOG_BASE_URL_META_KEY
      });
    }
    return resolved;
  }

  if (PROVIDER_CATALOG_BASE_URL_OVERRIDE) {
    providerResolveLogger.warn('provider catalog base url override used', {
      sourceUrl: PROVIDER_CATALOG_LINK_SOURCE_URL,
      providerCatalogBaseUrl: PROVIDER_CATALOG_BASE_URL_OVERRIDE
    });
    providerCatalogBaseUrlCache = {
      value: PROVIDER_CATALOG_BASE_URL_OVERRIDE,
      expiresAt: now + (PROVIDER_LINK_SOURCE_CACHE_TTL_SECONDS * 1000)
    };
    return PROVIDER_CATALOG_BASE_URL_OVERRIDE;
  }

  const persisted = await readPersistedProviderCatalogBaseUrl();
  if (persisted) {
    providerResolveLogger.warn('provider catalog base url persisted fallback used', {
      sourceUrl: PROVIDER_CATALOG_LINK_SOURCE_URL,
      providerCatalogBaseUrl: persisted
    });
    providerCatalogBaseUrlCache = {
      value: persisted,
      expiresAt: now + (PROVIDER_LINK_SOURCE_CACHE_TTL_SECONDS * 1000)
    };
    return persisted;
  }

  providerResolveLogger.error('provider catalog base url resolution failed', {
    sourceUrl: PROVIDER_CATALOG_LINK_SOURCE_URL
  });
  return null;
}

async function fetchProviderCatalogBaseUrlFromTelegraph(): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(PROVIDER_CATALOG_LINK_SOURCE_URL, {
      headers: {
        accept: 'application/json'
      }
    });
  } catch {
    providerResolveLogger.error('provider link source request failed', {
      url: PROVIDER_CATALOG_LINK_SOURCE_URL
    });
    return null;
  }

  if (!res.ok) {
    providerResolveLogger.error('provider link source response invalid', {
      url: PROVIDER_CATALOG_LINK_SOURCE_URL,
      status: res.status
    });
    return null;
  }

  let payload: TelegraphPageResponse;
  try {
    payload = await res.json() as TelegraphPageResponse;
  } catch {
    providerResolveLogger.error('provider link source payload invalid', {
      url: PROVIDER_CATALOG_LINK_SOURCE_URL
    });
    return null;
  }

  const href = extractFirstHref(payload.result?.content);
  if (!href) {
    providerResolveLogger.error('provider link source href missing', {
      url: PROVIDER_CATALOG_LINK_SOURCE_URL
    });
    return null;
  }

  try {
    const parsed = new URL(href);
    const normalized = parsed.toString().replace(/\/$/, '');
    debug('provider catalog base url resolved', {
      sourceUrl: PROVIDER_CATALOG_LINK_SOURCE_URL,
      providerCatalogBaseUrl: normalized
    });
    return normalized;
  } catch {
    providerResolveLogger.error('provider link source href invalid', {
      url: PROVIDER_CATALOG_LINK_SOURCE_URL,
      href
    });
    return null;
  }
}

function extractFirstHref(nodes: TelegraphPageNode[] | undefined): string | null {
  if (!nodes?.length) return null;

  for (const node of nodes) {
    const href = extractHrefFromNode(node);
    if (href) return href;
  }

  return null;
}

function extractHrefFromNode(node: TelegraphPageNode | string): string | null {
  if (typeof node === 'string') return null;
  const href = typeof node.attrs?.href === 'string' ? node.attrs.href.trim() : '';
  if (href) {
    return href;
  }

  const children = node.children ?? [];
  for (const child of children) {
    const nested = extractHrefFromNode(child);
    if (nested) return nested;
  }

  return null;
}

async function persistProviderCatalogBaseUrl(value: string): Promise<void> {
  await kdb
    .insertInto('_meta')
    .values({
      key: PROVIDER_CATALOG_BASE_URL_META_KEY,
      value
    })
    .onConflict((oc) => oc.column('key').doUpdateSet({
      value
    }))
    .execute();
}

async function readPersistedProviderCatalogBaseUrl(): Promise<string | null> {
  const row = await kdb
    .selectFrom('_meta')
    .select('value')
    .where('key', '=', PROVIDER_CATALOG_BASE_URL_META_KEY)
    .executeTakeFirst();

  const value = row?.value?.trim() ?? '';
  if (!value) return null;

  try {
    return new URL(value).toString().replace(/\/$/, '');
  } catch {
    providerResolveLogger.warn('provider catalog base url persisted value invalid', {
      key: PROVIDER_CATALOG_BASE_URL_META_KEY
    });
    return null;
  }
}
