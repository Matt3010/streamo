package com.streamo.app.ui.tv.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import coil.ImageLoader
import coil.annotation.ExperimentalCoilApi
import com.streamo.app.download.DownloadInfrastructure
import com.streamo.app.tmdb.TMDBClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

/**
 * Backs [TvCacheManagementScreen]. Specchia le categorie della phone
 * [com.streamo.app.ui.settings.CacheManagementViewModel] (TMDB + immagini +
 * streaming) senza la lista download (nascosta su TV). Usa gli stessi
 * singleton: [TMDBClient] per la cache offline e [ImageLoader] per Coil.
 */
@HiltViewModel
@OptIn(ExperimentalCoilApi::class)
class TvCacheManagementViewModel @Inject constructor(
    private val tmdbClient: TMDBClient,
    private val imageLoader: ImageLoader
) : ViewModel() {

    private val _streamingBytes = MutableStateFlow(0L)
    val streamingBytes: StateFlow<Long> = _streamingBytes.asStateFlow()

    private val _tmdbBytes = MutableStateFlow(0L)
    val tmdbBytes: StateFlow<Long> = _tmdbBytes.asStateFlow()

    private val _tmdbCount = MutableStateFlow(0)
    val tmdbCount: StateFlow<Int> = _tmdbCount.asStateFlow()

    private val _imageBytes = MutableStateFlow(0L)
    val imageBytes: StateFlow<Long> = _imageBytes.asStateFlow()

    val imageMaxBytes: StateFlow<Long> = MutableStateFlow(imageLoader.diskCache?.maxSize ?: 0L)
        .asStateFlow()

    init { refreshAll() }

    fun refreshAll() {
        viewModelScope.launch {
            _streamingBytes.value = withContext(Dispatchers.IO) {
                runCatching { DownloadInfrastructure.playbackCache.cacheSpace }.getOrDefault(0L)
            }
            _tmdbBytes.value = tmdbClient.cacheTotalBytes()
            _tmdbCount.value = tmdbClient.cacheTotalCount()
            _imageBytes.value = withContext(Dispatchers.IO) {
                runCatching { imageLoader.diskCache?.size ?: 0L }.getOrDefault(0L)
            }
        }
    }

    fun clearStreamingCache() {
        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                val cache = DownloadInfrastructure.playbackCache
                cache.keys.toList().forEach { key ->
                    cache.getCachedSpans(key).toList().forEach { span ->
                        runCatching { cache.removeSpan(span) }
                    }
                }
            }
            refreshAll()
        }
    }

    fun clearTmdbCache() {
        viewModelScope.launch {
            tmdbClient.clearAllCache()
            refreshAll()
        }
    }

    fun clearImageCache() {
        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                imageLoader.memoryCache?.clear()
                imageLoader.diskCache?.clear()
            }
            refreshAll()
        }
    }

    /** Streaming + TMDB + immagini (NON i download — nascosti su TV). */
    fun clearAllCaches() {
        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                val cache = DownloadInfrastructure.playbackCache
                cache.keys.toList().forEach { key ->
                    cache.getCachedSpans(key).toList().forEach { span ->
                        runCatching { cache.removeSpan(span) }
                    }
                }
                imageLoader.memoryCache?.clear()
                imageLoader.diskCache?.clear()
            }
            tmdbClient.clearAllCache()
            refreshAll()
        }
    }
}