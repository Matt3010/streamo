package com.streamo.app.tmdb

/**
 * TTL (in secondi) della cache persistente TMDB, per tipo di asset. Costanti
 * fisse: le durate non sono esposte in Impostazioni. Vedere la policy in
 * `stateless-greeting-hellman.md`.
 */
object TmdbCacheTtl {
    const val LIST_SECONDS = 6L * 60 * 60             // 6h  — trending/popular/weekly, home rows, section
    const val DISCOVER_SECONDS = 12L * 60 * 60        // 12h — discover/browse by genre (sorted)
    const val SEARCH_SECONDS = 1L * 60 * 60          // 1h  — volatile
    const val DETAILS_SECONDS = 7L * 24 * 60 * 60    // 7d  — movie/tv details (+ credits + videos)
    const val SEASON_SECONDS = 7L * 24 * 60 * 60      // 7d  — season details (episodes)
    const val RECOMMENDATIONS_SECONDS = 1L * 24 * 60 * 60 // 1d
    const val REVIEWS_SECONDS = 1L * 24 * 60 * 60     // 1d
    const val GENRES_SECONDS = 30L * 24 * 60 * 60     // 30d — quasi statico

    // Tipo di riga in tmdb_cache (usato per cancellazione selettiva e parsing).
    const val TYPE_LIST = "list"
    const val TYPE_DETAILS = "details"
    const val TYPE_SEASON = "season"
    const val TYPE_RECOMMENDATIONS = "recommendations"
    const val TYPE_REVIEWS = "reviews"
    const val TYPE_SEARCH = "search"
    const val TYPE_GENRES = "genres"
    const val TYPE_DISCOVER = "discover"
}