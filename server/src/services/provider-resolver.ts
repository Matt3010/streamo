import type { MediaType } from '../../../shared/types';
import { kdb } from '../db';
import {
  PROVIDER_CATALOG_BASE_URL,
  PROVIDER_CATALOG_LOCALE,
  PROVIDER_RESOLVE_CACHE_TTL
} from '../config';

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

type EpisodeCacheEntry = {
  expiresAt: number;
  value: ProviderLoadedSeason | null;
};

const resolveCache = new Map<string, CacheEntry>();
const seasonCache = new Map<string, EpisodeCacheEntry>();
const PROVIDER_NAME = 'streamingcommunity';
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
  console.log('[provider-resolver] match decision', {
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
    console.log('[provider-resolver] episode decision', {
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
    console.log('[provider-resolver] episode decision', {
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

  console.log('[provider-resolver] episode decision', {
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
  console.log('[provider-resolver] movie decision', {
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
  const url = new URL(`/${PROVIDER_CATALOG_LOCALE}/search`, PROVIDER_CATALOG_BASE_URL);
  url.searchParams.set('q', query);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8'
      }
    });
  } catch {
    console.error('[provider-resolver] fetch failed', { query, url: url.toString() });
    return null;
  }

  console.log('[provider-resolver] upstream response', {
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
      console.error('[provider-resolver] invalid json payload', { query, url: url.toString() });
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

  console.log('[provider-resolver] payload shape', {
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

  console.log('[provider-resolver] candidate summary', {
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
      match: null,
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
    .executeTakeFirst();

  if (!row) return undefined;

  if (row.match_status === 'manual_confirmed' || row.match_status === 'auto_confirmed') {
    if (row.provider_id) {
      return {
        provider: 'streamingcommunity',
        id: row.provider_id,
        slug: row.provider_slug,
        title: row.resolved_title ?? args.title,
        mediaType: args.mediaType
      };
    }
    return null;
  }

  const freshUntilMs = (row.last_checked_at * 1000) + (PROVIDER_RESOLVE_CACHE_TTL * 1000);
  if (freshUntilMs > nowMs) {
    return null;
  }

  return undefined;
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
    console.error('[provider-resolver] missing slug for season lookup', {
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

  const url = new URL(
    `/${PROVIDER_CATALOG_LOCALE}/titles/${providerTitleId}-${slug}/season-${seasonNumber}`,
    PROVIDER_CATALOG_BASE_URL
  );

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8'
      }
    });
  } catch {
    console.error('[provider-resolver] season fetch failed', {
      providerTitleId,
      slug,
      seasonNumber,
      url: url.toString()
    });
    return null;
  }

  console.log('[provider-resolver] season upstream response', {
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
      console.error('[provider-resolver] invalid season json payload', {
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
  console.log('[provider-resolver] season payload shape', {
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
  const url = new URL(
    `/${PROVIDER_CATALOG_LOCALE}/iframe/${providerTitleId}`,
    PROVIDER_CATALOG_BASE_URL
  );
  if (episodeId) {
    url.searchParams.set('episode_id', String(episodeId));
    url.searchParams.set('next_episode', '1');
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8'
      }
    });
  } catch {
    console.error('[provider-resolver] embed fetch failed', {
      providerTitleId,
      episodeId: episodeId ?? null,
      url: url.toString()
    });
    return null;
  }

  console.log('[provider-resolver] embed upstream response', {
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
    console.error('[provider-resolver] embed iframe src missing', {
      providerTitleId,
      episodeId: episodeId ?? null
    });
    return null;
  }

  const embedUrl = decodeHtmlEntities(match[1].trim());
  try {
    const parsed = new URL(embedUrl, PROVIDER_CATALOG_BASE_URL);
    const isVixEmbed = parsed.hostname === 'vixcloud.co' && parsed.pathname.startsWith('/embed/');
    if (!isVixEmbed) {
      console.error('[provider-resolver] unexpected embed host', {
        providerTitleId,
        episodeId: episodeId ?? null,
        embedUrl
      });
      return null;
    }

    const relative = `/embed${parsed.pathname.slice('/embed'.length)}${parsed.search}`;
    console.log('[provider-resolver] embed url resolved', {
      providerTitleId,
      episodeId: episodeId ?? null,
      embedUrl: relative
    });
    return relative;
  } catch {
    console.error('[provider-resolver] invalid embed url', {
      providerTitleId,
      episodeId: episodeId ?? null,
      embedUrl
    });
    return null;
  }
}
