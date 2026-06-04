package com.streamo.app.tmdb

import com.streamo.app.data.remote.TMDBApi
import com.streamo.app.data.remote.dto.TmdbItem
import com.streamo.app.data.remote.dto.TmdbListResponse
import com.streamo.app.data.remote.dto.TmdbReview
import com.streamo.app.data.remote.dto.TmdbSeasonDetails
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import com.streamo.app.data.preferences.SettingsDataStore
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class TMDBClient @Inject constructor(
    private val api: TMDBApi,
    private val settings: SettingsDataStore
) {
    private val detailCache = LinkedHashMap<String, TmdbItem>()
    private val detailCacheMax = 100

    private val dateFormatter = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply {
        calendar = java.util.Calendar.getInstance(TimeZone.getTimeZone("UTC"))
    }

    suspend fun apiKey(): String = settings.tmdbApiKey.first()

    suspend fun details(id: Int, type: String): TmdbItem {
        val key = "$type-$id"
        detailCache[key]?.let { return it }
        val item = api.details(type = type, id = id, apiKey = apiKey())
        cacheDetail(item, key)
        return item
    }

    suspend fun seasonDetails(tvId: Int, season: Int): TmdbSeasonDetails {
        return api.seasonDetails(tvId = tvId, season = season, apiKey = apiKey())
    }

    suspend fun recommendations(id: Int, type: String): List<TmdbItem> {
        return api.recommendations(type = type, id = id, apiKey = apiKey()).results.orEmpty()
    }

    suspend fun reviews(id: Int, type: String): List<TmdbReview> {
        val attempts = listOf("it-IT", "", "en-US")
        for (lang in attempts) {
            val res: TmdbListResponse<TmdbReview> = if (lang.isEmpty()) {
                api.reviews(type = type, id = id, apiKey = apiKey(), language = "")
            } else {
                api.reviews(type = type, id = id, apiKey = apiKey(), language = lang)
            }
            if (!res.results.isNullOrEmpty()) return res.results
        }
        return emptyList()
    }

    suspend fun list(endpoint: String, page: Int = 1): List<TmdbItem> {
        val res = api.list(endpoint = endpoint, apiKey = apiKey(), page = page)
        return sortByNewest(res.results.orEmpty())
    }

    suspend fun searchMulti(query: String, page: Int = 1): List<TmdbItem> {
        val trimmed = query.trim()
        if (trimmed.isEmpty()) return emptyList()
        val res = api.searchMulti(apiKey = apiKey(), query = trimmed, page = page)
        val filtered = res.results.orEmpty().filter {
            (it.mediaType == "movie" || it.mediaType == "tv") &&
            it.genreIds?.contains(99) != true
        }
        return filtered
    }

    private fun cacheDetail(item: TmdbItem, key: String) {
        if (!detailCache.containsKey(key)) {
            if (detailCache.size >= detailCacheMax) {
                val first = detailCache.keys.firstOrNull()
                first?.let { detailCache.remove(it) }
            }
        }
        detailCache[key] = item
    }

    private fun sortByNewest(items: List<TmdbItem>): List<TmdbItem> {
        return items.sortedByDescending { newestTimestamp(it) }
    }

    private fun newestTimestamp(item: TmdbItem): Long {
        val raw = item.primaryDate
        if (raw.isNullOrEmpty()) return 0
        return try {
            dateFormatter.parse(raw)?.time ?: 0
        } catch (_: Exception) {
            0
        }
    }
}
