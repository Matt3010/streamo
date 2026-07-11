package com.streamo.app.tmdb

import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.streamo.app.data.local.dao.TmdbCacheDao
import com.streamo.app.data.local.entity.TmdbCacheEntry
import com.streamo.app.data.preferences.SettingsDataStore
import com.streamo.app.data.remote.TMDBApi
import com.streamo.app.data.remote.dto.TmdbGenre
import com.streamo.app.data.remote.dto.TmdbItem
import com.streamo.app.data.remote.dto.TmdbListResponse
import com.streamo.app.data.remote.dto.TmdbReview
import com.streamo.app.data.remote.dto.TmdbSeasonDetails
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Wrapper `@Singleton` di [TMDBApi] con cache a due livelli:
 * - **L1**: `LinkedHashMap` in-memory (max [l1Max] voci) con scadenza TTL — per le
 *   prestazioni in-sessione, persa al kill del processo.
 * - **L2**: tabella Room `tmdb_cache` con TTL — persistente, permette la
 *   navigazione offline. Su rete assente con riga scaduta si serve lo stale.
 *
 * I TTL sono costanti in [TmdbCacheTtl]; le chiavi in [TmdbCacheKey].
 * Il toggle `settings.tmdbCacheEnabled` disabilita solo L2 (L1 resta).
 */
@Singleton
class TMDBClient @Inject constructor(
    private val api: TMDBApi,
    private val settings: SettingsDataStore,
    private val cacheDao: TmdbCacheDao,
    private val gson: Gson
) {
    private val l1 = LinkedHashMap<String, Pair<Any, Long>>() // key -> (value, fetchedAt)
    private val l1Max = 100
    private val l1Lock = Mutex()

    // SimpleDateFormat is not thread-safe. TMDBClient is @Singleton, so concurrent
    // coroutines on different dispatchers could corrupt its internal state.
    // Synchronize every access through the l1Lock pattern (a dedicated lock).
    private val dateFormatter = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply {
        calendar = java.util.Calendar.getInstance(TimeZone.getTimeZone("UTC"))
    }
    private val dateFormatterLock = Any()

    suspend fun apiKey(): String = settings.tmdbApiKey.first()

    suspend fun details(id: Int, type: String): TmdbItem =
        cachedFetch(
            key = TmdbCacheKey.details(type, id),
            type = TmdbCacheTtl.TYPE_DETAILS,
            ttl = TmdbCacheTtl.DETAILS_SECONDS
        ) {
            api.details(type = type, id = id, apiKey = apiKey())
        }

    suspend fun seasonDetails(tvId: Int, season: Int): TmdbSeasonDetails =
        cachedFetch(
            key = TmdbCacheKey.season(tvId, season),
            type = TmdbCacheTtl.TYPE_SEASON,
            ttl = TmdbCacheTtl.SEASON_SECONDS
        ) {
            api.seasonDetails(tvId = tvId, season = season, apiKey = apiKey())
        }

    suspend fun recommendations(id: Int, type: String): List<TmdbItem> =
        cachedFetch(
            key = TmdbCacheKey.recommendations(type, id),
            type = TmdbCacheTtl.TYPE_RECOMMENDATIONS,
            ttl = TmdbCacheTtl.RECOMMENDATIONS_SECONDS
        ) {
            api.recommendations(type = type, id = id, apiKey = apiKey()).results.orEmpty()
        }

    suspend fun reviews(id: Int, type: String): List<TmdbReview> =
        cachedFetch(
            key = TmdbCacheKey.reviews(type, id),
            type = TmdbCacheTtl.TYPE_REVIEWS,
            ttl = TmdbCacheTtl.REVIEWS_SECONDS
        ) {
            val attempts = listOf("it-IT", "", "en-US")
            for (lang in attempts) {
                val res: TmdbListResponse<TmdbReview> = if (lang.isEmpty()) {
                    api.reviews(type = type, id = id, apiKey = apiKey(), language = "")
                } else {
                    api.reviews(type = type, id = id, apiKey = apiKey(), language = lang)
                }
                if (!res.results.isNullOrEmpty()) return@cachedFetch res.results
            }
            emptyList()
        }

    suspend fun list(endpoint: String, page: Int = 1): List<TmdbItem> =
        cachedFetch(
            key = TmdbCacheKey.list(endpoint, page),
            type = TmdbCacheTtl.TYPE_LIST,
            ttl = TmdbCacheTtl.LIST_SECONDS
        ) {
            val res = api.list(endpoint = endpoint, apiKey = apiKey(), page = page)
            sortByNewest(res.results.orEmpty())
        }

    suspend fun searchMulti(query: String, page: Int = 1): List<TmdbItem> =
        cachedFetch(
            key = TmdbCacheKey.searchMulti(query, page),
            type = TmdbCacheTtl.TYPE_SEARCH,
            ttl = TmdbCacheTtl.SEARCH_SECONDS
        ) {
            val trimmed = query.trim()
            if (trimmed.isEmpty()) return@cachedFetch emptyList()
            val res = api.searchMulti(apiKey = apiKey(), query = trimmed, page = page)
            res.results.orEmpty().filter {
                (it.mediaType == "movie" || it.mediaType == "tv") &&
                    it.genreIds?.contains(99) != true
            }
        }

    suspend fun searchMovie(query: String, page: Int = 1, genreIds: Collection<Int>? = null): List<TmdbItem> =
        cachedFetch(
            key = TmdbCacheKey.searchMovie(query, page, genreIds?.joinToString(",")),
            type = TmdbCacheTtl.TYPE_SEARCH,
            ttl = TmdbCacheTtl.SEARCH_SECONDS
        ) {
            val trimmed = query.trim()
            if (trimmed.isEmpty()) return@cachedFetch emptyList()
            val withGenres = genreIds?.joinToString(",")?.takeIf { it.isNotEmpty() }
            val res = api.searchMovie(
                apiKey = apiKey(), query = trimmed, page = page,
                withGenres = withGenres
            )
            var results = res.results.orEmpty().filter { it.genreIds?.contains(99) != true }
            if (!genreIds.isNullOrEmpty()) {
                results = results.filter { item -> item.genreIds?.any { it in genreIds } == true }
            }
            results.map { it.copy(mediaType = "movie") }
        }

    suspend fun searchTv(query: String, page: Int = 1, genreIds: Collection<Int>? = null): List<TmdbItem> =
        cachedFetch(
            key = TmdbCacheKey.searchTv(query, page, genreIds?.joinToString(",")),
            type = TmdbCacheTtl.TYPE_SEARCH,
            ttl = TmdbCacheTtl.SEARCH_SECONDS
        ) {
            val trimmed = query.trim()
            if (trimmed.isEmpty()) return@cachedFetch emptyList()
            val withGenres = genreIds?.joinToString(",")?.takeIf { it.isNotEmpty() }
            val res = api.searchTv(
                apiKey = apiKey(), query = trimmed, page = page,
                withGenres = withGenres
            )
            var results = res.results.orEmpty().filter { it.genreIds?.contains(99) != true }
            if (!genreIds.isNullOrEmpty()) {
                results = results.filter { item -> item.genreIds?.any { it in genreIds } == true }
            }
            results.map { it.copy(mediaType = "tv") }
        }

    suspend fun genres(): List<TmdbGenre> =
        cachedFetch(
            key = TmdbCacheKey.genres,
            type = TmdbCacheTtl.TYPE_GENRES,
            ttl = TmdbCacheTtl.GENRES_SECONDS
        ) {
            val movieGenres = api.genreMovieList(apiKey = apiKey()).genres
            val tvGenres = api.genreTvList(apiKey = apiKey()).genres
            (movieGenres + tvGenres).distinctBy { it.id }.sortedBy { it.name }
        }

    suspend fun browseMovies(
        page: Int = 1,
        genreIds: Collection<Int>? = null,
        sortBy: String = "popularity.desc"
    ): List<TmdbItem> =
        cachedFetch(
            key = TmdbCacheKey.discover("movie", page, genreIds?.joinToString(","), sortBy),
            type = TmdbCacheTtl.TYPE_DISCOVER,
            ttl = TmdbCacheTtl.DISCOVER_SECONDS
        ) {
            val withGenres = genreIds?.joinToString(",")?.takeIf { it.isNotEmpty() }
            api.discoverMovie(apiKey = apiKey(), page = page, withGenres = withGenres, sortBy = sortBy)
                .results.orEmpty()
                .filter { it.genreIds?.contains(99) != true }
                .map { it.copy(mediaType = "movie") }
        }

    suspend fun browseTv(
        page: Int = 1,
        genreIds: Collection<Int>? = null,
        sortBy: String = "popularity.desc"
    ): List<TmdbItem> =
        cachedFetch(
            key = TmdbCacheKey.discover("tv", page, genreIds?.joinToString(","), sortBy),
            type = TmdbCacheTtl.TYPE_DISCOVER,
            ttl = TmdbCacheTtl.DISCOVER_SECONDS
        ) {
            val withGenres = genreIds?.joinToString(",")?.takeIf { it.isNotEmpty() }
            api.discoverTv(apiKey = apiKey(), page = page, withGenres = withGenres, sortBy = sortBy)
                .results.orEmpty()
                .filter { it.genreIds?.contains(99) != true }
                .map { it.copy(mediaType = "tv") }
        }

    // --- Gestione cache (per Impostazioni) ---

    /** Cancella tutte le righe di una categoria (L2 + voci L1 corrispondenti). */
    suspend fun clearCacheType(type: String) {
        cacheDao.deleteByType(type)
        l1Lock.withLock { l1.entries.removeAll { TmdbCacheKey.matchesType(it.key, type) } }
    }

    /** Cancella tutta la cache TMDB (L2 + L1). */
    suspend fun clearAllCache() {
        cacheDao.deleteAll()
        l1Lock.withLock { l1.clear() }
    }

    suspend fun cacheBytesByType(type: String): Long = cacheDao.bytesByType(type)

    suspend fun cacheTotalBytes(): Long = cacheDao.bytes()

    suspend fun cacheTotalCount(): Int = cacheDao.count()

    suspend fun cacheCountByType(type: String): Int = cacheDao.countByType(type)

    /** Best-effort: rimuove le righe scadute. Chiamare all'avvio app. */
    suspend fun purgeExpired() { cacheDao.deleteExpired() }

    // --- Interni ---

    /**
     * L1 (in-memory, fresca) → L2 (Room, fresca) → network → fallback stale
     * (L2 scaduta, poi L1). Se il toggle cache è off, salta L2 read/write ma
     * mantiene L1 e il fallback stale-L1.
     */
    private suspend inline fun <reified T : Any> cachedFetch(
        key: String,
        type: String,
        ttl: Long,
        network: suspend () -> T
    ): T {
        val now = System.currentTimeMillis()
        val enabled = settings.tmdbCacheEnabled.first()

        // 1) L1 fresca
        l1Lock.withLock {
            l1[key]?.let { if (it.second + ttl * 1000 >= now) return it.first as T }
        }

        // 2) L2 fresca
        if (enabled) {
            val row = cacheDao.get(key)
            if (row != null && row.fetchedAt + row.ttlSeconds * 1000 >= now) {
                val parsed: T = parseL2(row.payload)
                putL1(key, parsed, row.fetchedAt)
                return parsed
            }
        }

        // 3) Network → fallback stale su eccezione
        return try {
            val value = network()
            putL1(key, value, now)
            if (enabled) {
                cacheDao.upsert(TmdbCacheEntry(key, type, gson.toJson(value), now, ttl))
            }
            value
        } catch (e: Exception) {
            if (enabled) {
                cacheDao.get(key)?.let { return parseL2(it.payload) }
            }
            l1Lock.withLock { l1[key]?.let { return it.first as T } }
            throw e
        }
    }

    private inline fun <reified T> parseL2(payload: String): T =
        gson.fromJson(payload, object : TypeToken<T>() {}.type)

    private suspend fun putL1(key: String, value: Any, fetchedAt: Long) = l1Lock.withLock {
        if (!l1.containsKey(key) && l1.size >= l1Max) {
            l1.remove(l1.keys.first())
        }
        l1[key] = value to fetchedAt
    }

    private fun sortByNewest(items: List<TmdbItem>): List<TmdbItem> =
        items.sortedByDescending { newestTimestamp(it) }

    private fun newestTimestamp(item: TmdbItem): Long {
        val raw = item.primaryDate
        if (raw.isNullOrEmpty()) return 0
        return try {
            synchronized(dateFormatterLock) {
                dateFormatter.parse(raw)?.time ?: 0
            }
        } catch (_: Exception) {
            0
        }
    }
}