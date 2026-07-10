// Dexie schema mirroring the Room entities in AppDatabase.kt.
// Field names match the Kotlin data classes EXACTLY so backup JSON is portable.
import Dexie from 'dexie';

export interface ProgressEntry {
  tmdbId: number;
  mediaType: string;
  season: number;
  episode: number;
  positionSeconds: number;
  durationSeconds: number;
  title: string;
  posterPath: string | null;
  updatedAt: number;
  /** AnimeUnity episode id (resume without re-fetching detail). Null for TMDB. */
  providerEpisodeId: number | null;
  /** AnimeUnity slug for the vixcloud embed Referer header. Null for TMDB. */
  providerSlug: string | null;
}

export interface HistoryEntry {
  tmdbId: number;
  mediaType: string;
  title: string;
  posterPath: string | null;
  season: number;
  episode: number;
  watchedAt: number;
  /** Start-of-day timestamp used to de-duplicate same-episode rows within one day. */
  watchedDay: number;
  /** Snapshot of the cumulative position (seconds) when this row was saved. */
  progressSeconds: number;
  /** Snapshot of the total duration (seconds) when this row was saved. */
  durationSeconds: number;
}

export interface WatchlistEntry {
  tmdbId: number;
  mediaType: string; // "movie" | "tv"
  title: string;
  posterPath: string | null;
  addedAt: number;
}

export interface ProviderMappingEntity {
  tmdbId: number;
  scId: number;
  scSlug: string;
  scType: string;
  scBaseUrl: string;
}

export interface TmdbCacheEntry {
  key: string;
  type: string;
  payload: string;
  fetchedAt: number;
  ttlSeconds: number;
}

export interface SearchHistoryEntry {
  query: string;
  searchedAt: number;
}

class StreamoDatabase extends Dexie {
  progress!: Dexie.Table<ProgressEntry, [number, string, number, number]>;
  history!: Dexie.Table<HistoryEntry, [number, string, number, number, number]>;
  watchlist!: Dexie.Table<WatchlistEntry, [number, string]>;
  providerMapping!: Dexie.Table<ProviderMappingEntity, number>;
  tmdbCache!: Dexie.Table<TmdbCacheEntry, string>;
  searchHistory!: Dexie.Table<SearchHistoryEntry, string>;

  constructor() {
    super('streamo');
    this.version(1).stores({
      progress: '[tmdbId+mediaType+season+episode], updatedAt',
      history: '[tmdbId+mediaType+season+episode+watchedDay], watchedAt',
      watchlist: '[tmdbId+mediaType], addedAt',
      providerMapping: 'tmdbId',
      tmdbCache: 'key, [type+fetchedAt]',
      searchHistory: 'query, searchedAt',
    });
  }
}

export const db = new StreamoDatabase();