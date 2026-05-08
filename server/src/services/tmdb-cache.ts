import { db } from '../db';
import { TMDB_API_KEY, TMDB_CACHE_TTL } from '../config';
import type { WatchlistSeasonInfo } from '../../../shared/types';

export interface TmdbTvSummary {
  number_of_seasons: number;
  number_of_episodes: number;
  seasons: WatchlistSeasonInfo[];
  /** Latest episode that has already aired — used to count released-only
   * episodes for the "Mancano N episodi" badge. Null if the show hasn't
   * started airing yet. */
  last_episode_to_air?: { season_number: number; episode_number: number } | null;
}

interface RawTmdbSeason {
  season_number?: number;
  episode_count?: number;
}

interface RawTmdbEpisodeRef {
  season_number?: number;
  episode_number?: number;
}

interface RawTmdbTv {
  number_of_seasons?: number;
  number_of_episodes?: number;
  seasons?: RawTmdbSeason[];
  last_episode_to_air?: RawTmdbEpisodeRef | null;
}

interface CacheRow {
  data: string;
  fetched_at: number;
}

// Fetches a TV show's headline counts from TMDB, with a 24h SQLite cache.
// Returns null on failure. Old cache entries that lack required fields
// (`seasons`, `last_episode_to_air`) are transparently refreshed so a
// schema bump doesn't require manual cache eviction.
export async function getTmdbTvSummary(tmdbId: number | string): Promise<TmdbTvSummary | null> {
  const key = `tv:${tmdbId}`;
  const now = Math.floor(Date.now() / 1000);
  const cached = db.prepare('SELECT data, fetched_at FROM tmdb_cache WHERE cache_key = ?').get(key) as CacheRow | undefined;
  if (cached && (now - cached.fetched_at) < TMDB_CACHE_TTL) {
    try {
      const parsed = JSON.parse(cached.data) as Partial<TmdbTvSummary>;
      // last_episode_to_air may legitimately be null (show not yet aired);
      // we only refresh when the key is *missing entirely* — i.e. the entry
      // was written before this field existed.
      if (Array.isArray(parsed.seasons) && 'last_episode_to_air' in parsed) {
        return parsed as TmdbTvSummary;
      }
    } catch { /* fall through */ }
  }
  if (!TMDB_API_KEY) return null;
  try {
    const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?language=it-IT&api_key=${TMDB_API_KEY}`);
    if (!res.ok) return null;
    const data = await res.json() as RawTmdbTv;
    const lea = data.last_episode_to_air;
    const stored: TmdbTvSummary = {
      number_of_seasons: data.number_of_seasons ?? 0,
      number_of_episodes: data.number_of_episodes ?? 0,
      seasons: (data.seasons ?? [])
        .filter((s): s is Required<Pick<RawTmdbSeason, 'season_number'>> & RawTmdbSeason => typeof s.season_number === 'number' && s.season_number > 0)
        .map(s => ({ season_number: s.season_number!, episode_count: s.episode_count ?? 0 })),
      last_episode_to_air: (lea && typeof lea.season_number === 'number' && typeof lea.episode_number === 'number')
        ? { season_number: lea.season_number, episode_number: lea.episode_number }
        : null
    };
    db.prepare('INSERT OR REPLACE INTO tmdb_cache (cache_key, data, fetched_at) VALUES (?, ?, ?)').run(key, JSON.stringify(stored), now);
    return stored;
  } catch {
    return null;
  }
}
