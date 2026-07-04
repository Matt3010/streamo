package com.streamo.app.tmdb

/**
 * Builder di chiavi deterministiche per la cache TMDB. Ogni chiave include
 * tutti i parametri che cambiano la risposta (endpoint+page, type+id,
 * tvId+season, query+page+genres, sortBy) così chiamate identiche condividono
 * la riga mentre un qualunque param diverso fa miss. I prefissi coincidono con
 * i `TYPE_*` di [TmdbCacheTtl] per consentire l'eviction L1 per categoria.
 */
object TmdbCacheKey {
    fun list(endpoint: String, page: Int) = "${TmdbCacheTtl.TYPE_LIST}:$endpoint:p$page"
    fun details(type: String, id: Int) = "${TmdbCacheTtl.TYPE_DETAILS}:$type:$id"
    fun season(tvId: Int, season: Int) = "${TmdbCacheTtl.TYPE_SEASON}:$tvId:$season"
    fun recommendations(type: String, id: Int) = "${TmdbCacheTtl.TYPE_RECOMMENDATIONS}:$type:$id"
    fun reviews(type: String, id: Int) = "${TmdbCacheTtl.TYPE_REVIEWS}:$type:$id"
    fun searchMulti(query: String, page: Int) = "${TmdbCacheTtl.TYPE_SEARCH}:multi:${query.lowercase()}:p$page"
    fun searchMovie(query: String, page: Int, genres: String?) =
        "${TmdbCacheTtl.TYPE_SEARCH}:movie:${query.lowercase()}:p$page:g${genres ?: ""}"
    fun searchTv(query: String, page: Int, genres: String?) =
        "${TmdbCacheTtl.TYPE_SEARCH}:tv:${query.lowercase()}:p$page:g${genres ?: ""}"
    fun discover(media: String, page: Int, genres: String?, sortBy: String) =
        "${TmdbCacheTtl.TYPE_DISCOVER}:$media:p$page:g${genres ?: ""}:s$sortBy"
    const val genres = "${TmdbCacheTtl.TYPE_GENRES}:merged"

    /** True se la chiave L1 appartiene alla categoria `type` (prefisso). */
    fun matchesType(key: String, type: String): Boolean = key.startsWith("$type:")
}