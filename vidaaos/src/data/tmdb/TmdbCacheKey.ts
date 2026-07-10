// Deterministic cache key builders for the TMDB cache. Each key includes
// every parameter that changes the response (endpoint+page, type+id,
// tvId+season, query+page+genres, sortBy) so identical calls share a row
// while any differing param misses. Prefixes match the TYPE_* of
// TmdbCacheTtl to allow L1 eviction by category.
// Verbatim copy of TmdbCacheKey.kt.

import { TmdbCacheTtl } from './TmdbCacheTtl';

export const TmdbCacheKey = {
  list(endpoint: string, page: number): string {
    return `${TmdbCacheTtl.TYPE_LIST}:${endpoint}:p${page}`;
  },
  details(type: string, id: number): string {
    return `${TmdbCacheTtl.TYPE_DETAILS}:${type}:${id}`;
  },
  season(tvId: number, season: number): string {
    return `${TmdbCacheTtl.TYPE_SEASON}:${tvId}:${season}`;
  },
  recommendations(type: string, id: number): string {
    return `${TmdbCacheTtl.TYPE_RECOMMENDATIONS}:${type}:${id}`;
  },
  reviews(type: string, id: number): string {
    return `${TmdbCacheTtl.TYPE_REVIEWS}:${type}:${id}`;
  },
  searchMulti(query: string, page: number): string {
    return `${TmdbCacheTtl.TYPE_SEARCH}:multi:${query.toLowerCase()}:p${page}`;
  },
  searchMovie(query: string, page: number, genres: string | null): string {
    return `${TmdbCacheTtl.TYPE_SEARCH}:movie:${query.toLowerCase()}:p${page}:g${genres ?? ''}`;
  },
  searchTv(query: string, page: number, genres: string | null): string {
    return `${TmdbCacheTtl.TYPE_SEARCH}:tv:${query.toLowerCase()}:p${page}:g${genres ?? ''}`;
  },
  discover(media: string, page: number, genres: string | null, sortBy: string): string {
    return `${TmdbCacheTtl.TYPE_DISCOVER}:${media}:p${page}:g${genres ?? ''}:s${sortBy}`;
  },
  genres: `${TmdbCacheTtl.TYPE_GENRES}:merged`,

  /** True if the L1 key belongs to category `type` (prefix match). */
  matchesType(key: string, type: string): boolean {
    return key.startsWith(`${type}:`);
  },
};

// ponytail: one self-check, fails if key format drifts from Kotlin.
export function demo(): void {
  const k = TmdbCacheKey.list('trending/movie/day', 1);
  // Kotlin: "${TYPE_LIST}:$endpoint:p$page"  -> "list:trending/movie/day:p1"
  console.assert(k === 'list:trending/movie/day:p1', `list key mismatch: ${k}`);
  const d = TmdbCacheKey.details('movie', 42);
  console.assert(d === 'details:movie:42', `details key mismatch: ${d}`);
  const s = TmdbCacheKey.searchMovie('Foo Bar', 2, '28,12');
  console.assert(
    s === 'search:movie:foo bar:p2:g28,12',
    `searchMovie key mismatch: ${s}`,
  );
  const g = TmdbCacheKey.discover('tv', 3, null, 'popularity.desc');
  console.assert(
    g === 'discover:tv:p3:g:spopularity.desc',
    `discover key mismatch: ${g}`,
  );
  console.assert(TmdbCacheKey.matchesType('list:x:p1', 'list') === true);
  console.assert(TmdbCacheKey.matchesType('details:movie:1', 'list') === false);
}