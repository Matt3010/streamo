import type { MediaType, ProviderResolveFailureReason } from '../../../shared/types';
import { kdb } from '../db';
import {
  PROVIDER_CATALOG_LINK_SOURCE_URL,
  PROVIDER_LINK_SOURCE_CACHE_TTL_SECONDS,
  PROVIDER_CATALOG_LOCALE,
  PROVIDER_RESOLVE_CACHE_TTL,
  PROVIDER_RESOLVER_DEBUG
} from '../config';
import { providerResolveLogger } from './provider-resolve-logs';
import { getRedisPublisher, hasRedisConfig } from './redis';
import { searchTmdbPosterUrl } from './tmdb-cache';
import { fetchWithTimeout } from '../utils/fetch';
import { isFutureDateStr } from '../../../shared/release-format';
import { recordProviderOutageEvent } from './admin-health';

const PROVIDER_REQUEST_TIMEOUT_MS = 8000;

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

export interface ProviderResolveOutcome<T> {
  resolved: T | null;
  reason: ProviderResolveFailureReason | null;
}

export interface ProviderManualRefreshState {
  // True when the user has explicitly clicked the manual refresh / picker
  // refresh button at least once before — drives the confirmation modal
  // on subsequent clicks. There's no actual rate limit any more.
  requiresConfirm: boolean;
}

export interface ProviderResolvedTitleCandidate {
  providerTitleId: number;
  providerSlug: string | null;
  title: string;
  year: number | null;
  score: number;
  posterUrl: string | null;
}

export interface ProviderResolvedTitleOutcome extends ProviderResolveOutcome<ProviderResolvedTitle> {
  manualRefresh: ProviderManualRefreshState;
  candidates: ProviderResolvedTitleCandidate[];
  matchStatus: MatchStatus | null;
}

type MatchStatus = 'auto_confirmed' | 'manual_confirmed' | 'failed';

const MAX_STORED_CANDIDATES = 10;
const MIN_CANDIDATE_SCORE = 40;

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
  candidates: ProviderResolvedTitleCandidate[];
  matchStatus: MatchStatus | null;
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

type ProviderCatalogBaseUrlChangeSource = 'telegraph' | 'persisted';

type AttemptResult<T> =
  | { ok: true; value: T }
  | { ok: false; retryable: boolean; log: () => void };

interface StoredProviderMappingRow {
  provider: string;
  provider_id: number | null;
  provider_slug: string | null;
  resolved_title: string | null;
  match_status: MatchStatus;
  last_checked_at: number;
  candidates_json: string | null;
}

const resolveCache = new Map<string, CacheEntry>();
const seasonCache = new Map<string, EpisodeCacheEntry>();
let providerCatalogBaseUrlRefreshInFlight: Promise<string | null> | null = null;
const PROVIDER_NAME = 'streamingcommunity';
const PROVIDER_CATALOG_BASE_URL_META_KEY = 'provider_catalog_base_url';
const STRONG_MATCH_THRESHOLD = 170;
const PROVIDER_CATALOG_BASE_URL_REFRESH_COOLDOWN_MS = 30 * 1000;
const PROVIDER_CATALOG_BASE_URL_REDIS_KEY = 'streamo:provider:catalog-base-url';
const PROVIDER_CATALOG_BASE_URL_REFRESH_COOLDOWN_REDIS_KEY = 'streamo:provider:catalog-base-url:refresh-cooldown';

export async function resolveProviderTitle(
  args: ResolveArgs,
  options?: { forceRefresh?: boolean; manualRefreshOverride?: ProviderManualRefreshState }
): Promise<ProviderResolvedTitleOutcome> {
  const cacheKey = `${args.mediaType}:${args.tmdbId}`;
  const now = Date.now();
  const override = options?.manualRefreshOverride;

  // Skip the upstream search for titles that haven't been released yet:
  // the provider catalogue won't have an entry, the search would just
  // burn an HTTP request and pollute the mapping cache with a 'failed'
  // row. We intentionally do NOT touch the in-memory cache or DB here
  // — when the release date crosses today, the next call performs a
  // fresh resolve without needing manual invalidation.
  if (isFutureDateStr(args.releaseDate ?? null)) {
    providerResolveLogger.info('title resolve skipped: unreleased', {
      tmdbId: args.tmdbId,
      mediaType: args.mediaType,
      releaseDate: args.releaseDate ?? null
    });
    return finalizeTitleResolveOutcome(args, null, 'unreleased', override, [], null);
  }

  if (!options?.forceRefresh) {
    const cached = resolveCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return finalizeTitleResolveOutcome(args, cached.value, cached.value ? null : 'not_found', override, cached.candidates, cached.matchStatus);
    }
  }

  if (!options?.forceRefresh) {
    const stored = await readStoredMapping(args, now);
    if (stored !== undefined) {
      cacheResolve(cacheKey, stored.resolved, stored.candidates, stored.matchStatus, now);
      return finalizeTitleResolveOutcome(args, stored.resolved, stored.resolved ? null : 'not_found', override, stored.candidates, stored.matchStatus);
    }
  }

  const query = args.title.trim();
  if (!query) {
    await upsertMapping(args, {
      matchStatus: 'failed',
      matchConfidence: 0,
      failureReason: 'missing_title',
      candidate: null,
      candidates: []
    }, now);
    cacheResolve(cacheKey, null, [], 'failed', now);
    return finalizeTitleResolveOutcome(args, null, 'not_found', override, [], 'failed');
  }

  const page = await fetchProviderSearchPage(query);
  if (!page) {
    void recordProviderOutageEvent();
    return finalizeTitleResolveOutcome(args, null, 'temporarily_unavailable', override, [], null);
  }

  const titles = extractProviderTitles(page);
  logCandidateSummary(args, titles);
  const best = pickBestMatch(titles, args);
  const candidates = await buildCandidateList(titles, args);
  let { match, persistence } = finalizeMatch(best, candidates);

  // A given provider_title_id can be claimed by only one TMDB title at a
  // time (UNIQUE INDEX on provider_title_map). If our top auto match has
  // already been claimed by another TMDB id (typically because that user
  // manual-confirmed it), don't try to upsert with that provider_id —
  // we'd get a 23505 violation that crashes the resolve. Downgrade to
  // failed with candidates preserved so the user can still pick another.
  if (match?.id != null) {
    const claimed = await kdb
      .selectFrom('provider_title_map')
      .select('tmdb_id')
      .where('provider', '=', PROVIDER_NAME)
      .where('media_type', '=', args.mediaType)
      .where('provider_id', '=', match.id)
      .where('tmdb_id', '!=', args.tmdbId)
      .executeTakeFirst();
    if (claimed) {
      providerResolveLogger.info('auto match already claimed', {
        tmdbId: args.tmdbId,
        providerId: match.id,
        claimedByTmdbId: claimed.tmdb_id
      });
      match = null;
      persistence = {
        matchStatus: 'failed',
        matchConfidence: 0,
        failureReason: 'provider_id_claimed_elsewhere',
        candidate: null,
        candidates
      };
    }
  }

  providerResolveLogger.info('title match decision', {
    query: args.title,
    mediaType: args.mediaType,
    tmdbId: args.tmdbId,
    releaseDate: args.releaseDate ?? null,
    bestScore: best?.score ?? null,
    selected: match
      ? { id: match.id, slug: match.slug, title: match.title, mediaType: match.mediaType }
      : null,
    candidateCount: candidates.length,
    persistence
  });
  await upsertMapping(args, persistence, now);
  cacheResolve(cacheKey, match, candidates, persistence.matchStatus, now);
  return finalizeTitleResolveOutcome(args, match, match ? null : 'not_found', override, candidates, persistence.matchStatus);
}

export async function resolveProviderEpisode(args: {
  providerTitleId: number;
  providerSlug: string | null;
  seasonNumber: number;
  episodeNumber: number;
}): Promise<ProviderResolveOutcome<ProviderResolvedEpisode>> {
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
    return { resolved: null, reason: 'temporarily_unavailable' };
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
    return { resolved: null, reason: 'not_found' };
  }

  const embedUrl = await fetchProviderEmbedUrl(args.providerTitleId, match.id);

  providerResolveLogger.info('episode resolve decision', {
    providerTitleId: args.providerTitleId,
    providerSlug: args.providerSlug,
    seasonNumber: args.seasonNumber,
    episodeNumber: args.episodeNumber,
    resolved: { episodeId: match.id, embedUrl }
  });

  if (!embedUrl) {
    return { resolved: null, reason: 'temporarily_unavailable' };
  }

  return {
    resolved: { episodeId: match.id, embedUrl },
    reason: null
  };
}

export async function resolveProviderMovie(args: {
  providerTitleId: number;
}): Promise<ProviderResolveOutcome<ProviderResolvedMovie>> {
  const embedUrl = await fetchProviderEmbedUrl(args.providerTitleId);
  providerResolveLogger.info('movie resolve decision', {
    providerTitleId: args.providerTitleId,
    resolved: embedUrl ? { embedUrl } : null
  });

  if (!embedUrl) {
    return { resolved: null, reason: 'temporarily_unavailable' };
  }

  return {
    resolved: { embedUrl },
    reason: null
  };
}

export async function refreshProviderTitle(args: ResolveArgs): Promise<ProviderResolvedTitleOutcome> {
  // No server-side cooldown gate: every manual click triggers a fresh
  // provider query. The frontend confirmation modal is the only friction
  // against accidental spam. We still record the timestamp so the UI can
  // show "you tried X minutes ago" if it wants to.
  const now = Math.floor(Date.now() / 1000);
  await markProviderManualRefresh(args, now);

  return resolveProviderTitle(args, {
    forceRefresh: true,
    manualRefreshOverride: buildProviderManualRefreshState(now)
  });
}

export async function manuallyConfirmProviderTitle(args: {
  tmdbId: number;
  mediaType: MediaType;
  providerTitleId: number;
}): Promise<ProviderResolvedTitleOutcome> {
  const cacheKey = `${args.mediaType}:${args.tmdbId}`;

  // Load the persisted candidate list. The user can only confirm one of the
  // candidates we previously fetched — we never call the provider here.
  const row = await kdb
    .selectFrom('provider_title_map')
    .select(['source_title', 'candidates_json'])
    .where('tmdb_id', '=', args.tmdbId)
    .where('media_type', '=', args.mediaType)
    .where('provider', '=', PROVIDER_NAME)
    .executeTakeFirst();

  if (!row) {
    return finalizeTitleResolveOutcome(
      { tmdbId: args.tmdbId, mediaType: args.mediaType, title: '', releaseDate: null },
      null,
      'not_found',
      undefined,
      [],
      'failed'
    );
  }

  const candidates = parseCandidatesJson(row.candidates_json);
  const chosen = candidates.find((c) => c.providerTitleId === args.providerTitleId);
  if (!chosen) {
    // Choice doesn't match any stored candidate — refuse without mutating.
    const resolveArgs: ResolveArgs = {
      tmdbId: args.tmdbId,
      mediaType: args.mediaType,
      title: row.source_title,
      releaseDate: null
    };
    return finalizeTitleResolveOutcome(resolveArgs, null, 'not_found', undefined, candidates, 'failed');
  }

  const resolveArgs: ResolveArgs = {
    tmdbId: args.tmdbId,
    mediaType: args.mediaType,
    title: row.source_title,
    releaseDate: null
  };
  const resolved: ProviderResolvedTitle = {
    provider: 'streamingcommunity',
    id: chosen.providerTitleId,
    slug: chosen.providerSlug,
    title: chosen.title,
    mediaType: args.mediaType
  };

  // A provider title id can only be claimed by one TMDB title at a time
  // (enforced by the unique index on (provider, media_type, provider_id)
  // WHERE provider_id IS NOT NULL). If another row already owns this
  // provider_id, the user's explicit pick wins — clear the old row's
  // mapping so the upsert below doesn't trip the constraint. The
  // displaced TMDB title will be re-resolved from scratch the next time
  // anyone visits its page.
  const evicted = await kdb
    .updateTable('provider_title_map')
    .set({
      provider_id: null,
      provider_slug: null,
      match_status: 'failed',
      match_confidence: 0,
      resolved_title: null,
      failure_reason: 'displaced_by_manual_confirm',
      resolved_at: null,
      last_checked_at: 0
    })
    .where('provider', '=', PROVIDER_NAME)
    .where('media_type', '=', args.mediaType)
    .where('provider_id', '=', chosen.providerTitleId)
    .where('tmdb_id', '!=', args.tmdbId)
    .returning('tmdb_id')
    .execute();

  for (const row of evicted) {
    resolveCache.delete(`${args.mediaType}:${row.tmdb_id}`);
  }
  if (evicted.length > 0) {
    providerResolveLogger.info('manual confirm displaced existing mapping', {
      mediaType: args.mediaType,
      providerTitleId: chosen.providerTitleId,
      displacedTmdbIds: evicted.map((r) => r.tmdb_id)
    });
  }

  await upsertMapping(resolveArgs, {
    matchStatus: 'manual_confirmed',
    matchConfidence: chosen.score,
    failureReason: null,
    candidate: resolved,
    candidates
  }, Date.now());

  cacheResolve(cacheKey, resolved, candidates, 'manual_confirmed', Date.now());

  providerResolveLogger.info('manual confirm', {
    tmdbId: args.tmdbId,
    mediaType: args.mediaType,
    chosenProviderTitleId: chosen.providerTitleId,
    chosenTitle: chosen.title
  });

  return finalizeTitleResolveOutcome(resolveArgs, resolved, null, undefined, candidates, 'manual_confirmed');
}

function cacheResolve(
  key: string,
  value: ProviderResolvedTitle | null,
  candidates: ProviderResolvedTitleCandidate[],
  matchStatus: MatchStatus | null,
  now: number
): void {
  resolveCache.set(key, {
    value,
    candidates,
    matchStatus,
    expiresAt: now + (PROVIDER_RESOLVE_CACHE_TTL * 1000)
  });
}

async function fetchProviderSearchPage(query: string): Promise<ProviderSearchPage | null> {
  return withProviderCatalogBaseUrlRetry('search', { query }, async (providerCatalogBaseUrl) => {
    const url = new URL(`/${PROVIDER_CATALOG_LOCALE}/search`, providerCatalogBaseUrl);
    url.searchParams.set('q', query);

    let res: Response;
    try {
      res = await fetchWithTimeout(url, {
        referrerPolicy: 'no-referrer',
        headers: {
          accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8'
        }
      }, PROVIDER_REQUEST_TIMEOUT_MS);
    } catch {
      return failureAttempt(true, () => {
        providerResolveLogger.error('search request failed', { query, url: url.toString() });
      });
    }

    debug('search upstream response', {
      query,
      url: url.toString(),
      status: res.status,
      contentType: res.headers.get('content-type') ?? ''
    });

    if (!res.ok) {
      return failureAttempt(true, () => {
        providerResolveLogger.error('search response invalid', {
          query,
          url: url.toString(),
          status: res.status
        });
      });
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        const page = await res.json() as ProviderSearchPage;
        logProviderPayloadShape(query, page, 'json');
        return successAttempt(page);
      } catch {
        return failureAttempt(true, () => {
          providerResolveLogger.error('search payload invalid', { query, url: url.toString() });
        });
      }
    }

    const html = await res.text();
    const page = parseInertiaPageFromHtml(html);
    if (!page) {
      return failureAttempt(true, () => {
        providerResolveLogger.error('search page payload missing', { query, url: url.toString() });
      });
    }
    logProviderPayloadShape(query, page, 'html');
    return successAttempt(page);
  });
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

function finalizeMatch(
  best: { candidate: ProviderResolvedTitle; score: number } | null,
  candidates: ProviderResolvedTitleCandidate[]
): {
  match: ProviderResolvedTitle | null;
  persistence: {
    matchStatus: MatchStatus;
    matchConfidence: number;
    failureReason: string | null;
    candidate: ProviderResolvedTitle | null;
    candidates: ProviderResolvedTitleCandidate[];
  };
} {
  if (!best) {
    return {
      match: null,
      persistence: {
        matchStatus: 'failed',
        matchConfidence: 0,
        failureReason: 'no_match',
        candidate: null,
        candidates
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
        candidate: best.candidate,
        candidates
      }
    };
  }

  // Weak match: don't auto-use it. The candidate list is persisted so the
  // user can pick from the picker UI; without a manual confirmation the
  // title plays as "failed".
  return {
    match: null,
    persistence: {
      matchStatus: 'failed',
      matchConfidence: best.score,
      failureReason: 'low_confidence',
      candidate: null,
      candidates
    }
  };
}

async function buildCandidateList(
  titles: ProviderSearchTitle[],
  args: ResolveArgs
): Promise<ProviderResolvedTitleCandidate[]> {
  const wantedYear = extractYear(args.releaseDate ?? null);
  const top = titles
    .filter((title) => title.id && normalizeProviderType(title.type) === args.mediaType)
    .map((title) => ({ title, score: scoreCandidate(title, args.title, wantedYear) }))
    .filter(({ score }) => score >= MIN_CANDIDATE_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_STORED_CANDIDATES);

  // Enrich each candidate with a TMDB poster (the streamingcommunity search
  // payload doesn't include reliable image URLs, but TMDB does and we have
  // it cached anyway). Lookups run in parallel; failures fall back to null
  // posters which the UI handles gracefully.
  const candidates = await Promise.all(top.map(async ({ title, score }) => {
    const providerName = title.name?.trim() || args.title;
    const year = extractYear(getProviderReleaseDate(title));
    const posterUrl = await searchTmdbPosterUrl(providerName, args.mediaType, year);
    return {
      providerTitleId: title.id as number,
      providerSlug: title.slug ?? null,
      title: providerName,
      year,
      score,
      posterUrl
    };
  }));

  return candidates;
}

async function finalizeTitleResolveOutcome(
  args: ResolveArgs,
  resolved: ProviderResolvedTitle | null,
  reason: ProviderResolveFailureReason | null,
  manualRefreshOverride?: ProviderManualRefreshState,
  candidates: ProviderResolvedTitleCandidate[] = [],
  matchStatus: MatchStatus | null = null
): Promise<ProviderResolvedTitleOutcome> {
  return {
    resolved,
    reason,
    manualRefresh: manualRefreshOverride ?? await readProviderManualRefreshState(args),
    candidates,
    matchStatus
  };
}

interface StoredMappingHit {
  resolved: ProviderResolvedTitle | null;
  candidates: ProviderResolvedTitleCandidate[];
  matchStatus: MatchStatus;
}

async function readStoredMapping(
  args: ResolveArgs,
  nowMs: number
): Promise<StoredMappingHit | undefined> {
  const row = await kdb
    .selectFrom('provider_title_map')
    .select([
      'provider',
      'provider_id',
      'provider_slug',
      'resolved_title',
      'match_status',
      'last_checked_at',
      'candidates_json'
    ])
    .where('tmdb_id', '=', args.tmdbId)
    .where('media_type', '=', args.mediaType)
    .where('provider', '=', PROVIDER_NAME)
    .executeTakeFirst() as StoredProviderMappingRow | undefined;

  if (!row) return undefined;

  const candidates = parseCandidatesJson(row.candidates_json);

  // Once we have a confirmed provider title id, treat it as durable and
  // never go back to the provider's search endpoint just to "re-find" it.
  // Slug / season / embed lookups may still happen later, but title-id
  // resolution itself is locked to the persisted mapping.
  if (row.match_status === 'auto_confirmed' || row.match_status === 'manual_confirmed') {
    return {
      resolved: toConfirmedResolvedTitle(row, args),
      candidates,
      matchStatus: row.match_status
    };
  }

  const freshUntilMs = (row.last_checked_at * 1000) + (PROVIDER_RESOLVE_CACHE_TTL * 1000);
  if (freshUntilMs > nowMs) {
    return { resolved: null, candidates, matchStatus: 'failed' };
  }

  return undefined;
}

function toConfirmedResolvedTitle(
  row: Pick<StoredProviderMappingRow, 'provider_id' | 'provider_slug' | 'resolved_title'>,
  args: ResolveArgs
): ProviderResolvedTitle | null {
  if (!row.provider_id) return null;
  return {
    provider: 'streamingcommunity',
    id: row.provider_id,
    slug: row.provider_slug,
    title: row.resolved_title ?? args.title,
    mediaType: args.mediaType
  };
}

function parseCandidatesJson(value: string | null): ProviderResolvedTitleCandidate[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is ProviderResolvedTitleCandidate => (
      !!entry
      && typeof entry === 'object'
      && typeof (entry as { providerTitleId?: unknown }).providerTitleId === 'number'
      && typeof (entry as { title?: unknown }).title === 'string'
      && typeof (entry as { score?: unknown }).score === 'number'
    ));
  } catch {
    return [];
  }
}

async function readProviderManualRefreshState(args: ResolveArgs): Promise<ProviderManualRefreshState> {
  // requiresConfirm only triggers after the user has explicitly clicked the
  // manual refresh / picker buttons at least once. Auto-resolves don't
  // count: with the cooldown gate removed, conflating them would surface
  // the confirmation modal on the first manual click of any title that's
  // ever been auto-resolved, which is annoying.
  const row = await kdb
    .selectFrom('provider_manual_refresh_cooldowns')
    .select('last_manual_refresh_at')
    .where('tmdb_id', '=', args.tmdbId)
    .where('media_type', '=', args.mediaType)
    .where('provider', '=', PROVIDER_NAME)
    .executeTakeFirst();
  return buildProviderManualRefreshState(row?.last_manual_refresh_at ?? null);
}

function buildProviderManualRefreshState(lastManualAt: number | null): ProviderManualRefreshState {
  // Accidental spam is filtered by the confirmation modal, not by a wait.
  // If the user has clicked manually before, subsequent clicks go through
  // a "sei sicuro?" step.
  return { requiresConfirm: lastManualAt !== null };
}

async function markProviderManualRefresh(args: ResolveArgs, now: number): Promise<void> {
  // Unconditional upsert — no rate limit, no race-gate. Records when the
  // user last manually retried so the frontend can drive `requiresConfirm`.
  await kdb
    .insertInto('provider_manual_refresh_cooldowns')
    .values({
      tmdb_id: args.tmdbId,
      media_type: args.mediaType,
      provider: PROVIDER_NAME,
      last_manual_refresh_at: now
    })
    .onConflict((oc) => oc
      .columns(['tmdb_id', 'media_type', 'provider'])
      .doUpdateSet({ last_manual_refresh_at: now })
    )
    .execute();
}

async function upsertMapping(
  args: ResolveArgs,
  result: {
    matchStatus: MatchStatus;
    matchConfidence: number;
    failureReason: string | null;
    candidate: ProviderResolvedTitle | null;
    candidates: ProviderResolvedTitleCandidate[];
  },
  nowMs: number
): Promise<void> {
  const now = Math.floor(nowMs / 1000);
  const releaseYear = extractYear(args.releaseDate ?? null);
  const resolvedAt = result.matchStatus === 'auto_confirmed' || result.matchStatus === 'manual_confirmed'
    ? now
    : null;
  const candidatesJson = result.candidates.length > 0 ? JSON.stringify(result.candidates) : null;

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
      last_checked_at: now,
      candidates_json: candidatesJson
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
      last_checked_at: now,
      candidates_json: candidatesJson
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

  const loadedSeason = await withProviderCatalogBaseUrlRetry('season', {
    providerTitleId,
    slug,
    seasonNumber
  }, async (providerCatalogBaseUrl) => {
    const url = new URL(
      `/${PROVIDER_CATALOG_LOCALE}/titles/${providerTitleId}-${slug}/season-${seasonNumber}`,
      providerCatalogBaseUrl
    );

    let res: Response;
    try {
      res = await fetchWithTimeout(url, {
        referrerPolicy: 'no-referrer',
        headers: {
          accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8'
        }
      }, PROVIDER_REQUEST_TIMEOUT_MS);
    } catch {
      return failureAttempt(true, () => {
        providerResolveLogger.error('season request failed', {
          providerTitleId,
          slug,
          seasonNumber,
          url: url.toString()
        });
      });
    }

    debug('season page upstream response', {
      providerTitleId,
      slug,
      seasonNumber,
      url: url.toString(),
      status: res.status,
      contentType: res.headers.get('content-type') ?? ''
    });

    if (!res.ok) {
      return failureAttempt(true, () => {
        providerResolveLogger.error('season response invalid', {
          providerTitleId,
          slug,
          seasonNumber,
          url: url.toString(),
          status: res.status
        });
      });
    }

    const contentType = res.headers.get('content-type') ?? '';
    let page: ProviderTitlePage | null = null;
    if (contentType.includes('application/json')) {
      try {
        page = await res.json() as ProviderTitlePage;
      } catch {
        return failureAttempt(true, () => {
          providerResolveLogger.error('season payload invalid', {
            providerTitleId,
            slug,
            seasonNumber,
            url: url.toString()
          });
        });
      }
    } else {
      const html = await res.text();
      page = parseInertiaPageFromHtml(html) as ProviderTitlePage | null;
    }

    const loaded = extractLoadedSeason(page);
    if (!loaded) {
      return failureAttempt(true, () => {
        providerResolveLogger.error('season payload missing', {
          providerTitleId,
          slug,
          seasonNumber,
          url: url.toString()
        });
      });
    }

    debug('season episodes payload', {
      providerTitleId,
      slug,
      seasonNumber,
      loadedSeasonNumber: loaded.number ?? null,
      episodesCount: loaded.episodes?.length ?? 0,
      sampleEpisodes: (loaded.episodes ?? [])
        .slice(0, 5)
        .map((episode) => ({
          id: episode.id ?? null,
          number: episode.number ?? null,
          scwsId: episode.scws_id ?? null
        }))
    });

    return successAttempt(loaded);
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
  return withProviderCatalogBaseUrlRetry('embed', {
    providerTitleId,
    episodeId: episodeId ?? null
  }, async (providerCatalogBaseUrl) => {
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
      res = await fetchWithTimeout(url, {
        referrerPolicy: 'no-referrer',
        headers: {
          accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8'
        }
      }, PROVIDER_REQUEST_TIMEOUT_MS);
    } catch {
      return failureAttempt(true, () => {
        providerResolveLogger.error('embed request failed', {
          providerTitleId,
          episodeId: episodeId ?? null,
          url: url.toString()
        });
      });
    }

    debug('embed page upstream response', {
      providerTitleId,
      episodeId: episodeId ?? null,
      url: url.toString(),
      status: res.status,
      contentType: res.headers.get('content-type') ?? ''
    });

    if (!res.ok) {
      return failureAttempt(true, () => {
        providerResolveLogger.error('embed response invalid', {
          providerTitleId,
          episodeId: episodeId ?? null,
          url: url.toString(),
          status: res.status
        });
      });
    }

    const html = await res.text();
    const match = html.match(/<iframe[^>]+src="([^"]+)"/i) || html.match(/<iframe[^>]+src='([^']+)'/i);
    if (!match?.[1]) {
      return failureAttempt(true, () => {
        providerResolveLogger.error('embed iframe src missing', {
          providerTitleId,
          episodeId: episodeId ?? null,
          url: url.toString()
        });
      });
    }

    const embedUrl = decodeHtmlEntities(match[1].trim());
    try {
      const parsed = new URL(embedUrl, providerCatalogBaseUrl);
      const isVixEmbed = parsed.hostname === 'vixcloud.co' && parsed.pathname.startsWith('/embed/');
      if (!isVixEmbed) {
        return failureAttempt(true, () => {
          providerResolveLogger.error('embed host unexpected', {
            providerTitleId,
            episodeId: episodeId ?? null,
            url: url.toString(),
            embedUrl
          });
        });
      }

      const relative = `/embed${parsed.pathname.slice('/embed'.length)}${parsed.search}`;
      providerResolveLogger.info('embed url resolved', {
        providerTitleId,
        episodeId: episodeId ?? null,
        embedUrl: relative
      });
      return successAttempt(relative);
    } catch {
      return failureAttempt(true, () => {
        providerResolveLogger.error('embed url invalid', {
          providerTitleId,
          episodeId: episodeId ?? null,
          url: url.toString(),
          embedUrl
        });
      });
    }
  });
}

async function getProviderCatalogBaseUrl(): Promise<string | null> {
  const cachedBaseUrl = await readCachedProviderCatalogBaseUrl();
  if (cachedBaseUrl) {
    return cachedBaseUrl;
  }

  const persisted = await readPersistedProviderCatalogBaseUrl();
  if (persisted) {
    providerResolveLogger.warn('provider catalog base url persisted fallback used', {
      sourceUrl: PROVIDER_CATALOG_LINK_SOURCE_URL,
      providerCatalogBaseUrl: persisted
    });
    await cacheProviderCatalogBaseUrl(persisted);
    return persisted;
  }

  const resolved = await fetchProviderCatalogBaseUrlFromTelegraph();
  if (resolved) {
    await cacheProviderCatalogBaseUrl(resolved);
    try {
      await persistProviderCatalogBaseUrl(resolved);
    } catch {
      providerResolveLogger.warn('provider catalog base url persist failed', {
        key: PROVIDER_CATALOG_BASE_URL_META_KEY
      });
    }
    return resolved;
  }

  providerResolveLogger.error('provider catalog base url resolution failed', {
    sourceUrl: PROVIDER_CATALOG_LINK_SOURCE_URL
  });
  return null;
}

async function fetchProviderCatalogBaseUrlFromTelegraph(): Promise<string | null> {
  let res: Response;
  try {
    res = await fetchWithTimeout(PROVIDER_CATALOG_LINK_SOURCE_URL, {
      headers: {
        accept: 'application/json'
      }
    }, PROVIDER_REQUEST_TIMEOUT_MS);
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

async function cacheProviderCatalogBaseUrl(value: string): Promise<void> {
  if (!hasRedisConfig()) {
    return;
  }

  try {
    await getRedisPublisher().set(
      PROVIDER_CATALOG_BASE_URL_REDIS_KEY,
      value,
      'EX',
      PROVIDER_LINK_SOURCE_CACHE_TTL_SECONDS
    );
  } catch {}
}

function successAttempt<T>(value: T): AttemptResult<T> {
  return { ok: true, value };
}

function failureAttempt(retryable: boolean, log: () => void): AttemptResult<never> {
  return { ok: false, retryable, log };
}

async function withProviderCatalogBaseUrlRetry<T>(
  reason: string,
  context: Record<string, unknown>,
  attempt: (providerCatalogBaseUrl: string) => Promise<AttemptResult<T>>
): Promise<T | null> {
  const providerCatalogBaseUrl = await getProviderCatalogBaseUrl();
  if (!providerCatalogBaseUrl) {
    providerResolveLogger.error('provider catalog base url unavailable', {
      sourceUrl: PROVIDER_CATALOG_LINK_SOURCE_URL,
      reason,
      ...context
    });
    return null;
  }

  const firstAttempt = await attempt(providerCatalogBaseUrl);
  if (firstAttempt.ok) {
    return firstAttempt.value;
  }

  if (firstAttempt.retryable) {
    const refreshedBaseUrl = await refreshProviderCatalogBaseUrl(providerCatalogBaseUrl, reason, context);
    if (refreshedBaseUrl && refreshedBaseUrl !== providerCatalogBaseUrl) {
      const secondAttempt = await attempt(refreshedBaseUrl);
      if (secondAttempt.ok) {
        return secondAttempt.value;
      }
      secondAttempt.log();
      return null;
    }
  }

  firstAttempt.log();
  return null;
}

async function refreshProviderCatalogBaseUrl(
  previousBaseUrl: string,
  reason: string,
  context: Record<string, unknown>
): Promise<string | null> {
  if (providerCatalogBaseUrlRefreshInFlight) {
    return providerCatalogBaseUrlRefreshInFlight;
  }

  // Assign the promise synchronously before any await so concurrent callers
  // see the in-flight promise and share its result. The cooldown gate lives
  // inside the IIFE: without Redis it always succeeds (single-process dedup
  // happens via this in-flight promise); with Redis it cross-process-dedups.
  providerCatalogBaseUrlRefreshInFlight = (async () => {
    const refreshAllowed = await tryBeginProviderCatalogBaseUrlRefreshCooldown();
    if (!refreshAllowed) {
      return null;
    }

    const telegraphBaseUrl = await fetchProviderCatalogBaseUrlFromTelegraph();
    if (telegraphBaseUrl) {
      await cacheProviderCatalogBaseUrl(telegraphBaseUrl);
      try {
        await persistProviderCatalogBaseUrl(telegraphBaseUrl);
      } catch {
        providerResolveLogger.warn('provider catalog base url persist failed', {
          key: PROVIDER_CATALOG_BASE_URL_META_KEY
        });
      }
      if (telegraphBaseUrl !== previousBaseUrl) {
        logProviderCatalogBaseUrlChanged(previousBaseUrl, telegraphBaseUrl, 'telegraph', reason, context);
      }
      return telegraphBaseUrl;
    }

    const persisted = await readPersistedProviderCatalogBaseUrl();
    if (persisted && persisted !== previousBaseUrl) {
      await cacheProviderCatalogBaseUrl(persisted);
      logProviderCatalogBaseUrlChanged(previousBaseUrl, persisted, 'persisted', reason, context);
      return persisted;
    }

    return null;
  })();

  try {
    return await providerCatalogBaseUrlRefreshInFlight;
  } finally {
    providerCatalogBaseUrlRefreshInFlight = null;
  }
}

async function readCachedProviderCatalogBaseUrl(): Promise<string | null> {
  if (!hasRedisConfig()) {
    return null;
  }

  try {
    const cached = await getRedisPublisher().get(PROVIDER_CATALOG_BASE_URL_REDIS_KEY);
    return cached?.trim() || null;
  } catch {
    return null;
  }
}

async function tryBeginProviderCatalogBaseUrlRefreshCooldown(): Promise<boolean> {
  if (!hasRedisConfig()) {
    return true;
  }

  try {
    const result = await getRedisPublisher().set(
      PROVIDER_CATALOG_BASE_URL_REFRESH_COOLDOWN_REDIS_KEY,
      String(Date.now()),
      'PX',
      PROVIDER_CATALOG_BASE_URL_REFRESH_COOLDOWN_MS,
      'NX'
    );
    return result === 'OK';
  } catch {
    return true;
  }
}

function logProviderCatalogBaseUrlChanged(
  previousBaseUrl: string,
  nextBaseUrl: string,
  source: ProviderCatalogBaseUrlChangeSource,
  reason: string,
  context: Record<string, unknown>
): void {
  providerResolveLogger.info('provider catalog base url changed', {
    source,
    reason,
    previousBaseUrl,
    nextBaseUrl,
    ...context
  });
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
