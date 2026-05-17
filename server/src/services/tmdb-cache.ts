import { query } from '../db';
import { TMDB_API_KEY, TMDB_CACHE_TTL } from '../config';
import type { WatchlistSeasonInfo } from '../../../shared/types';
import {
  getAiredEpisodesCount as sharedGetAiredEpisodesCount,
  getBaseAiredEpisodesCount as sharedGetBaseAiredEpisodesCount
} from '../../../shared/release-format';

export { isFutureDateStr as isFutureDate } from '../../../shared/release-format';

export interface TmdbTvSummary {
  first_air_date?: string | null;
  number_of_seasons: number;
  number_of_episodes: number;
  seasons: WatchlistSeasonInfo[];
  last_episode_to_air?: { season_number: number; episode_number: number } | null;
  next_episode_to_air?: { season_number: number; episode_number: number; air_date?: string | null } | null;
}

export interface TmdbMovieSummary {
  release_date?: string | null;
}

interface RawTmdbSeason {
  season_number?: number;
  episode_count?: number;
}

interface RawTmdbEpisodeRef {
  season_number?: number;
  episode_number?: number;
  air_date?: string | null;
}

interface RawTmdbTv {
  first_air_date?: string | null;
  number_of_seasons?: number;
  number_of_episodes?: number;
  seasons?: RawTmdbSeason[];
  last_episode_to_air?: RawTmdbEpisodeRef | null;
  next_episode_to_air?: RawTmdbEpisodeRef | null;
}

interface RawTmdbMovie {
  release_date?: string | null;
}

interface CacheRow {
  data: string;
  fetched_at: number;
}

function toEpisodeRef(ref: RawTmdbEpisodeRef | null | undefined): TmdbTvSummary['next_episode_to_air'] {
  if (!ref || typeof ref.season_number !== 'number' || typeof ref.episode_number !== 'number') {
    return null;
  }

  return {
    season_number: ref.season_number,
    episode_number: ref.episode_number,
    air_date: ref.air_date ?? null
  };
}

function parseCachedSummary(data: string): TmdbTvSummary | null {
  try {
    const parsed = JSON.parse(data) as Partial<TmdbTvSummary>;
    if (
      !Array.isArray(parsed.seasons)
      || !('first_air_date' in parsed)
      || !('last_episode_to_air' in parsed)
      || !('next_episode_to_air' in parsed)
    ) {
      return null;
    }
    return parsed as TmdbTvSummary;
  } catch {
    return null;
  }
}

function parseCachedMovieSummary(data: string): TmdbMovieSummary | null {
  try {
    const parsed = JSON.parse(data) as Partial<TmdbMovieSummary>;
    if (!('release_date' in parsed)) return null;
    return parsed as TmdbMovieSummary;
  } catch {
    return null;
  }
}

export async function readCachedTmdbTvSummary(tmdbId: number | string): Promise<TmdbTvSummary | null> {
  const key = `tv:${tmdbId}`;
  const res = await query<Pick<CacheRow, 'data'>>(
    'SELECT data FROM tmdb_cache WHERE cache_key = $1', [key]
  );
  const cached = res.rows[0];
  if (!cached) return null;
  return parseCachedSummary(cached.data);
}

export function getAiredEpisodesCount(summary: TmdbTvSummary | null): number {
  return sharedGetAiredEpisodesCount(summary);
}

export function getBaseAiredEpisodesCount(summary: TmdbTvSummary | null): number {
  return sharedGetBaseAiredEpisodesCount(summary);
}

export async function getTmdbMovieSummary(
  tmdbId: number | string,
  options?: { forceRefresh?: boolean }
): Promise<TmdbMovieSummary | null> {
  const key = `movie:${tmdbId}`;
  const now = Math.floor(Date.now() / 1000);
  const cachedRes = await query<CacheRow>(
    'SELECT data, fetched_at FROM tmdb_cache WHERE cache_key = $1', [key]
  );
  const cached = cachedRes.rows[0];
  if (!options?.forceRefresh && cached && (now - cached.fetched_at) < TMDB_CACHE_TTL) {
    const parsed = parseCachedMovieSummary(cached.data);
    if (parsed) return parsed;
  }

  if (!TMDB_API_KEY) return null;

  try {
    const res = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?language=it-IT&api_key=${TMDB_API_KEY}`);
    if (!res.ok) return null;

    const data = await res.json() as RawTmdbMovie;
    const stored: TmdbMovieSummary = {
      release_date: data.release_date ?? null
    };

    await query(
      `INSERT INTO tmdb_cache (cache_key, data, fetched_at) VALUES ($1, $2, $3)
       ON CONFLICT (cache_key) DO UPDATE SET data = EXCLUDED.data, fetched_at = EXCLUDED.fetched_at`,
      [key, JSON.stringify(stored), now]
    );
    return stored;
  } catch {
    return null;
  }
}

// Fetches a TV show's headline counts from TMDB, with a Postgres cache.
// Old cache entries that lack required fields are transparently refreshed
// so schema bumps do not require manual cache eviction.
export async function getTmdbTvSummary(
  tmdbId: number | string,
  options?: { forceRefresh?: boolean }
): Promise<TmdbTvSummary | null> {
  const key = `tv:${tmdbId}`;
  const now = Math.floor(Date.now() / 1000);
  const cachedRes = await query<CacheRow>(
    'SELECT data, fetched_at FROM tmdb_cache WHERE cache_key = $1', [key]
  );
  const cached = cachedRes.rows[0];
  if (!options?.forceRefresh && cached && (now - cached.fetched_at) < TMDB_CACHE_TTL) {
    const parsed = parseCachedSummary(cached.data);
    if (parsed) return parsed;
  }

  if (!TMDB_API_KEY) return null;

  try {
    const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?language=it-IT&api_key=${TMDB_API_KEY}`);
    if (!res.ok) return null;

    const data = await res.json() as RawTmdbTv;
    const lea = data.last_episode_to_air;
    const stored: TmdbTvSummary = {
      first_air_date: data.first_air_date ?? null,
      number_of_seasons: data.number_of_seasons ?? 0,
      number_of_episodes: data.number_of_episodes ?? 0,
      seasons: (data.seasons ?? [])
        .filter((season): season is Required<Pick<RawTmdbSeason, 'season_number'>> & RawTmdbSeason => (
          typeof season.season_number === 'number' && season.season_number > 0
        ))
        .map((season) => ({ season_number: season.season_number!, episode_count: season.episode_count ?? 0 })),
      last_episode_to_air: (lea && typeof lea.season_number === 'number' && typeof lea.episode_number === 'number')
        ? { season_number: lea.season_number, episode_number: lea.episode_number }
        : null,
      next_episode_to_air: toEpisodeRef(data.next_episode_to_air)
    };

    await query(
      `INSERT INTO tmdb_cache (cache_key, data, fetched_at) VALUES ($1, $2, $3)
       ON CONFLICT (cache_key) DO UPDATE SET data = EXCLUDED.data, fetched_at = EXCLUDED.fetched_at`,
      [key, JSON.stringify(stored), now]
    );
    return stored;
  } catch {
    return null;
  }
}
