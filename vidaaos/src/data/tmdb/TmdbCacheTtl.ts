// TTLs (seconds) for the persistent TMDB cache, per asset type.
// Verbatim copy of TmdbCacheTtl.kt constants. Durations are not exposed in
// Settings — see the policy doc referenced in the Kotlin source.

export const TmdbCacheTtl = {
  LIST_SECONDS: 6 * 60 * 60, // 6h  — trending/popular/weekly, home rows, section
  DISCOVER_SECONDS: 12 * 60 * 60, // 12h — discover/browse by genre (sorted)
  SEARCH_SECONDS: 1 * 60 * 60, // 1h  — volatile
  DETAILS_SECONDS: 7 * 24 * 60 * 60, // 7d  — movie/tv details (+ credits + videos)
  SEASON_SECONDS: 7 * 24 * 60 * 60, // 7d  — season details (episodes)
  RECOMMENDATIONS_SECONDS: 1 * 24 * 60 * 60, // 1d
  REVIEWS_SECONDS: 1 * 24 * 60 * 60, // 1d
  GENRES_SECONDS: 30 * 24 * 60 * 60, // 30d — quasi static

  // Row type in tmdb_cache (used for selective eviction + parsing).
  TYPE_LIST: 'list',
  TYPE_DETAILS: 'details',
  TYPE_SEASON: 'season',
  TYPE_RECOMMENDATIONS: 'recommendations',
  TYPE_REVIEWS: 'reviews',
  TYPE_SEARCH: 'search',
  TYPE_GENRES: 'genres',
  TYPE_DISCOVER: 'discover',
} as const;

export type TmdbCacheType = typeof TmdbCacheTtl[keyof typeof TmdbCacheTtl];