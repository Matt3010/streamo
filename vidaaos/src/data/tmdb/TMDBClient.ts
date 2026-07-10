// TypeScript port of TMDBClient.kt.
// Two-level cache: L1 = Map (LRU@100) with TTL, L2 = Dexie `tmdbCache` table.
// L1 fresh -> L2 fresh -> network -> stale fallback (L2 then L1) on error.

import { db } from '../db';
import { settings } from '../settings';
import { TmdbCacheKey } from './TmdbCacheKey';
import { TmdbCacheTtl } from './TmdbCacheTtl';
import type {
  TmdbGenre,
  TmdbItem,
  TmdbListResponse,
  TmdbReview,
  TmdbSeasonDetails,
} from './dto';

// ponytail: Android bakes the key via BuildConfig.DEFAULT_TMDB_API_KEY; the web
// port has no BuildConfig, so the default comes from a Vite env var baked at
// build (VITE_TMDB_API_KEY in .env.local) and the user can override it in
// Settings (localStorage 'streamo.tmdb_api_key'). Env first, then Settings, then empty.
const DEFAULT_TMDB_API_KEY = (import.meta.env?.VITE_TMDB_API_KEY as string | undefined) || '';

const BASE_URL = 'https://api.themoviedb.org/3/';
const DEFAULT_LANGUAGE = 'it-IT';
const DEFAULT_REGION = 'IT';
const REQUEST_TIMEOUT_MS = 8000;
const L1_MAX = 100;

export const TMDB_API_KEY_MISSING_MESSAGE =
  'Chiave API TMDB non configurata. Inseriscila in Impostazioni.';

type L1Entry = { value: unknown; fetchedAt: number };

const l1 = new Map<string, L1Entry>();

function putL1(key: string, value: unknown, fetchedAt: number): void {
  if (!l1.has(key) && l1.size >= L1_MAX) {
    // Map iterates in insertion order; first entry is oldest.
    const firstKey = l1.keys().next().value;
    if (firstKey !== undefined) l1.delete(firstKey);
  }
  l1.set(key, { value, fetchedAt });
}

function apiKey(): string {
  return (settings.apiKey.value || DEFAULT_TMDB_API_KEY).trim();
}

export function hasTmdbApiKey(): boolean {
  return apiKey().length > 0;
}

function buildUrl(
  path: string,
  params: Record<string, string | number | undefined | null>,
): string {
  const key = apiKey();
  if (!key) throw new Error(TMDB_API_KEY_MISSING_MESSAGE);
  const u = new URL(BASE_URL + path);
  u.searchParams.set('api_key', key);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

async function tmdbFetch<T>(
  path: string,
  params: Record<string, string | number | undefined | null>,
): Promise<T> {
  const url = buildUrl(path, params);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`TMDB ${res.status}: ${res.statusText} for ${path}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// --- L2 helpers ---

interface TmdbCacheRow {
  key: string;
  type: string;
  payload: string;
  fetchedAt: number;
  ttlSeconds: number;
}

function isFresh(fetchedAt: number, ttlSeconds: number, now: number): boolean {
  return fetchedAt + ttlSeconds * 1000 >= now;
}

async function l2Get(key: string): Promise<TmdbCacheRow | undefined> {
  try {
    return (await db.tmdbCache.get(key)) as TmdbCacheRow | undefined;
  } catch {
    // ponytail: db not yet initialized in fresh boot — treat as miss.
    return undefined;
  }
}

async function l2Put(row: TmdbCacheRow): Promise<void> {
  try {
    await db.tmdbCache.put(row);
  } catch {
    // best-effort
  }
}

// --- Core cached fetch ---

async function cachedFetch<T>(
  key: string,
  type: string,
  ttl: number,
  network: () => Promise<T>,
): Promise<T> {
  const now = Date.now();

  // 1) L1 fresh
  const l1e = l1.get(key);
  if (l1e && isFresh(l1e.fetchedAt, ttl, now)) {
    return l1e.value as T;
  }

  // 2) L2 fresh
  const row = await l2Get(key);
  if (row && isFresh(row.fetchedAt, row.ttlSeconds, now)) {
    const parsed = JSON.parse(row.payload) as T;
    putL1(key, parsed, row.fetchedAt);
    return parsed;
  }

  // 3) Network -> stale fallback on error
  try {
    const value = await network();
    putL1(key, value, now);
    await l2Put({
      key,
      type,
      payload: JSON.stringify(value),
      fetchedAt: now,
      ttlSeconds: ttl,
    });
    return value;
  } catch (e) {
    const stale = await l2Get(key);
    if (stale) {
      const parsed = JSON.parse(stale.payload) as T;
      putL1(key, parsed, stale.fetchedAt);
      return parsed;
    }
    const l1Stale = l1.get(key);
    if (l1Stale) return l1Stale.value as T;
    throw e;
  }
}

// --- Date sorting (mirror sortByNewest / newestTimestamp) ---

function newestTimestamp(item: TmdbItem): number {
  const raw = item.release_date ?? item.first_air_date;
  if (!raw) return 0;
  // Kotlin uses UTC SimpleDateFormat "yyyy-MM-dd". Date.parse handles ISO date.
  const t = Date.parse(raw);
  return Number.isNaN(t) ? 0 : t;
}

function sortByNewest(items: TmdbItem[]): TmdbItem[] {
  return [...items].sort((a, b) => newestTimestamp(b) - newestTimestamp(a));
}

// --- Public API ---

export const TMDBClient = {
  async list(endpoint: string, page = 1): Promise<TmdbItem[]> {
    return cachedFetch<TmdbItem[]>(
      TmdbCacheKey.list(endpoint, page),
      TmdbCacheTtl.TYPE_LIST,
      TmdbCacheTtl.LIST_SECONDS,
      async () => {
        const res = await tmdbFetch<TmdbListResponse<TmdbItem>>(endpoint, {
          language: DEFAULT_LANGUAGE,
          region: DEFAULT_REGION,
          page,
        });
        return sortByNewest(res.results ?? []);
      },
    );
  },

  async details(id: number, type: string): Promise<TmdbItem> {
    return cachedFetch<TmdbItem>(
      TmdbCacheKey.details(type, id),
      TmdbCacheTtl.TYPE_DETAILS,
      TmdbCacheTtl.DETAILS_SECONDS,
      () =>
        tmdbFetch<TmdbItem>(`${type}/${id}`, {
          append_to_response: 'credits,videos',
          language: DEFAULT_LANGUAGE,
        }),
    );
  },

  async seasonDetails(tvId: number, season: number): Promise<TmdbSeasonDetails> {
    return cachedFetch<TmdbSeasonDetails>(
      TmdbCacheKey.season(tvId, season),
      TmdbCacheTtl.TYPE_SEASON,
      TmdbCacheTtl.SEASON_SECONDS,
      () =>
        tmdbFetch<TmdbSeasonDetails>(`tv/${tvId}/season/${season}`, {
          language: DEFAULT_LANGUAGE,
        }),
    );
  },

  async recommendations(id: number, type: string): Promise<TmdbItem[]> {
    return cachedFetch<TmdbItem[]>(
      TmdbCacheKey.recommendations(type, id),
      TmdbCacheTtl.TYPE_RECOMMENDATIONS,
      TmdbCacheTtl.RECOMMENDATIONS_SECONDS,
      async () => {
        const res = await tmdbFetch<TmdbListResponse<TmdbItem>>(
          `${type}/${id}/recommendations`,
          { language: DEFAULT_LANGUAGE },
        );
        return res.results ?? [];
      },
    );
  },

  async reviews(id: number, type: string): Promise<TmdbReview[]> {
    return cachedFetch<TmdbReview[]>(
      TmdbCacheKey.reviews(type, id),
      TmdbCacheTtl.TYPE_REVIEWS,
      TmdbCacheTtl.REVIEWS_SECONDS,
      async () => {
        const attempts = ['it-IT', '', 'en-US'];
        for (const lang of attempts) {
          const res = await tmdbFetch<TmdbListResponse<TmdbReview>>(
            `${type}/${id}/reviews`,
            lang === '' ? { language: '' } : { language: lang },
          );
          if (res.results && res.results.length > 0) return res.results;
        }
        return [];
      },
    );
  },

  async searchMulti(query: string, page = 1): Promise<TmdbItem[]> {
    return cachedFetch<TmdbItem[]>(
      TmdbCacheKey.searchMulti(query, page),
      TmdbCacheTtl.TYPE_SEARCH,
      TmdbCacheTtl.SEARCH_SECONDS,
      async () => {
        const trimmed = query.trim();
        if (trimmed.length === 0) return [];
        const res = await tmdbFetch<TmdbListResponse<TmdbItem>>('search/multi', {
          query: trimmed,
          language: DEFAULT_LANGUAGE,
          page,
        });
        return (res.results ?? []).filter(
          (it) =>
            (it.media_type === 'movie' || it.media_type === 'tv') &&
            it.genre_ids?.includes(99) !== true,
        );
      },
    );
  },

  async searchMovie(
    query: string,
    page = 1,
    genreIds: number[] | null = null,
  ): Promise<TmdbItem[]> {
    return cachedFetch<TmdbItem[]>(
      TmdbCacheKey.searchMovie(query, page, genreIds?.join(',') ?? null),
      TmdbCacheTtl.TYPE_SEARCH,
      TmdbCacheTtl.SEARCH_SECONDS,
      async () => {
        const trimmed = query.trim();
        if (trimmed.length === 0) return [];
        const withGenres = genreIds?.join(',') || undefined;
        const res = await tmdbFetch<TmdbListResponse<TmdbItem>>('search/movie', {
          query: trimmed,
          language: DEFAULT_LANGUAGE,
          page,
          with_genres: withGenres,
        });
        let results = (res.results ?? []).filter(
          (it) => it.genre_ids?.includes(99) !== true,
        );
        if (genreIds && genreIds.length > 0) {
          results = results.filter((it) =>
            it.genre_ids?.some((g) => genreIds.includes(g)),
          );
        }
        return results.map((it) => ({ ...it, media_type: 'movie' }));
      },
    );
  },

  async searchTv(
    query: string,
    page = 1,
    genreIds: number[] | null = null,
  ): Promise<TmdbItem[]> {
    return cachedFetch<TmdbItem[]>(
      TmdbCacheKey.searchTv(query, page, genreIds?.join(',') ?? null),
      TmdbCacheTtl.TYPE_SEARCH,
      TmdbCacheTtl.SEARCH_SECONDS,
      async () => {
        const trimmed = query.trim();
        if (trimmed.length === 0) return [];
        const withGenres = genreIds?.join(',') || undefined;
        const res = await tmdbFetch<TmdbListResponse<TmdbItem>>('search/tv', {
          query: trimmed,
          language: DEFAULT_LANGUAGE,
          page,
          with_genres: withGenres,
        });
        let results = (res.results ?? []).filter(
          (it) => it.genre_ids?.includes(99) !== true,
        );
        if (genreIds && genreIds.length > 0) {
          results = results.filter((it) =>
            it.genre_ids?.some((g) => genreIds.includes(g)),
          );
        }
        return results.map((it) => ({ ...it, media_type: 'tv' }));
      },
    );
  },

  async genres(): Promise<TmdbGenre[]> {
    return cachedFetch<TmdbGenre[]>(
      TmdbCacheKey.genres,
      TmdbCacheTtl.TYPE_GENRES,
      TmdbCacheTtl.GENRES_SECONDS,
      async () => {
        const movie = await tmdbFetch<{ genres: TmdbGenre[] }>(
          'genre/movie/list',
          { language: DEFAULT_LANGUAGE },
        );
        const tv = await tmdbFetch<{ genres: TmdbGenre[] }>('genre/tv/list', {
          language: DEFAULT_LANGUAGE,
        });
        const merged = [...(movie.genres ?? []), ...(tv.genres ?? [])];
        const seen = new Set<number>();
        const distinct: TmdbGenre[] = [];
        for (const g of merged) {
          if (!seen.has(g.id)) {
            seen.add(g.id);
            distinct.push(g);
          }
        }
        return distinct.sort((a, b) => a.name.localeCompare(b.name));
      },
    );
  },

  async browseMovies(
    page = 1,
    genreIds: number[] | null = null,
    sortBy = 'popularity.desc',
  ): Promise<TmdbItem[]> {
    return cachedFetch<TmdbItem[]>(
      TmdbCacheKey.discover('movie', page, genreIds?.join(',') ?? null, sortBy),
      TmdbCacheTtl.TYPE_DISCOVER,
      TmdbCacheTtl.DISCOVER_SECONDS,
      async () => {
        const withGenres = genreIds?.join(',') || undefined;
        const res = await tmdbFetch<TmdbListResponse<TmdbItem>>(
          'discover/movie',
          {
            language: DEFAULT_LANGUAGE,
            page,
            with_genres: withGenres,
            sort_by: sortBy,
          },
        );
        return (res.results ?? [])
          .filter((it) => it.genre_ids?.includes(99) !== true)
          .map((it) => ({ ...it, media_type: 'movie' }));
      },
    );
  },

  async browseTv(
    page = 1,
    genreIds: number[] | null = null,
    sortBy = 'popularity.desc',
  ): Promise<TmdbItem[]> {
    return cachedFetch<TmdbItem[]>(
      TmdbCacheKey.discover('tv', page, genreIds?.join(',') ?? null, sortBy),
      TmdbCacheTtl.TYPE_DISCOVER,
      TmdbCacheTtl.DISCOVER_SECONDS,
      async () => {
        const withGenres = genreIds?.join(',') || undefined;
        const res = await tmdbFetch<TmdbListResponse<TmdbItem>>('discover/tv', {
          language: DEFAULT_LANGUAGE,
          page,
          with_genres: withGenres,
          sort_by: sortBy,
        });
        return (res.results ?? [])
          .filter((it) => it.genre_ids?.includes(99) !== true)
          .map((it) => ({ ...it, media_type: 'tv' }));
      },
    );
  },

  // --- Cache management (for Settings) ---

  async clearCacheType(type: string): Promise<void> {
    // ponytail: db schema indexes [type+fetchedAt] (compound), not `type`
    // alone — use the compound range. Falls back to filter+bulkDelete if the
    // index shape differs.
    try {
      const rows = await db.tmdbCache.where('[type+fetchedAt]')
        .between([type, -Infinity], [type, Infinity], true, true)
        .toArray();
      if (rows.length > 0) await db.tmdbCache.bulkDelete(rows.map((r) => r.key));
    } catch {
      const all = await db.tmdbCache.toArray();
      const keys = all.filter((r) => r.type === type).map((r) => r.key);
      if (keys.length > 0) await db.tmdbCache.bulkDelete(keys);
    }
    for (const k of [...l1.keys()]) {
      if (TmdbCacheKey.matchesType(k, type)) l1.delete(k);
    }
  },

  async clearAllCache(): Promise<void> {
    try {
      await db.tmdbCache.clear();
    } catch {
      // best-effort
    }
    l1.clear();
  },

  async purgeExpired(): Promise<void> {
    const now = Date.now();
    try {
      const stale = await db.tmdbCache.toArray();
      const staleKeys = stale
        .filter((r) => !isFresh(r.fetchedAt, r.ttlSeconds, now))
        .map((r) => r.key);
      if (staleKeys.length > 0) await db.tmdbCache.bulkDelete(staleKeys);
    } catch {
      // best-effort
    }
  },
};
