package com.streamo.app.ui.settings

import android.app.Application
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import coil.ImageLoader
import coil.annotation.ExperimentalCoilApi
import com.streamo.app.data.local.entity.DownloadEntry
import com.streamo.app.data.preferences.SettingsDataStore
import com.streamo.app.data.repository.AppRepository
import com.streamo.app.download.DownloadInfrastructure
import com.streamo.app.download.DownloadQueueManager
import com.streamo.app.download.ResolveAndDownloadWorker
import com.streamo.app.tmdb.TMDBClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

/**
 * Backs the "Spazio e cache" settings sub-screen. Exposes the streaming cache size
 * (playback LRU store) + the download list, and provides clear/delete actions that
 * mirror the Downloads screen's purge path (cancel worker, wipe cached segments,
 * drop the DB row, advance the queue).
 *
 * Aggiunge la gestione della cache TMDB offline (risposte API su Room) e della
 * cache immagini Coil (disk cache), con cancellazione per categoria e "svuota
 * tutto" (streaming + TMDB + immagini; i download sono dati utente e non sono
 * toccati dal svuota-tutto).
 *
 * Note: streaming playback segments are written to a separate bounded LRU cache
 * ([DownloadInfrastructure.playbackCache], capped at 300 MB) so a long movie can no
 * longer fill device storage. This screen lets the user reclaim that space on demand.
 */
@HiltViewModel
@OptIn(ExperimentalCoilApi::class)
class CacheManagementViewModel @Inject constructor(
    private val repository: AppRepository,
    private val app: Application,
    private val queueManager: DownloadQueueManager,
    private val tmdbClient: TMDBClient,
    private val imageLoader: ImageLoader,
    private val settings: SettingsDataStore
) : ViewModel() {

    val entries: StateFlow<List<DownloadEntry>> = repository.downloads()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    private val _streamingCacheBytes = MutableStateFlow(0L)
    val streamingCacheBytes: StateFlow<Long> = _streamingCacheBytes.asStateFlow()

    private val _tmdbCacheBytes = MutableStateFlow(0L)
    val tmdbCacheBytes: StateFlow<Long> = _tmdbCacheBytes.asStateFlow()

    private val _tmdbCount = MutableStateFlow(0)
    val tmdbCount: StateFlow<Int> = _tmdbCount.asStateFlow()

    private val _imageCacheBytes = MutableStateFlow(0L)
    val imageCacheBytes: StateFlow<Long> = _imageCacheBytes.asStateFlow()

    val imageCacheMaxBytes: StateFlow<Long> = MutableStateFlow(imageLoader.diskCache?.maxSize ?: 0L)
        .asStateFlow()

    val cacheEnabled: StateFlow<Boolean> = settings.tmdbCacheEnabled
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), true)

    init { refreshAll() }

    /** Re-read every cache size from disk (call after clear + on open). */
    fun refreshAll() {
        refreshStreamingCache()
        refreshTmdbCache()
        refreshImageCache()
    }

    fun refreshStreamingCache() {
        viewModelScope.launch {
            val bytes = withContext(Dispatchers.IO) {
                runCatching { DownloadInfrastructure.playbackCache.cacheSpace }.getOrDefault(0L)
            }
            _streamingCacheBytes.value = bytes
        }
    }

    private fun refreshTmdbCache() {
        viewModelScope.launch {
            _tmdbCacheBytes.value = tmdbClient.cacheTotalBytes()
            _tmdbCount.value = tmdbClient.cacheTotalCount()
        }
    }

    private fun refreshImageCache() {
        viewModelScope.launch {
            _imageCacheBytes.value = withContext(Dispatchers.IO) {
                runCatching { imageLoader.diskCache?.size ?: 0L }.getOrDefault(0L)
            }
        }
    }

    /** Drop every cached segment in the playback cache. */
    fun clearStreamingCache() {
        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                val cache = DownloadInfrastructure.playbackCache
                // Snapshot before mutating: removeSpan mutates the span set mid-iteration.
                cache.keys.toList().forEach { key ->
                    cache.getCachedSpans(key).toList().forEach { span ->
                        runCatching { cache.removeSpan(span) }
                    }
                }
            }
            refreshStreamingCache()
        }
    }

    /** Svuota tutta la cache TMDB (risposte API su Room + L1 in-memory). */
    fun clearTmdbCache() {
        viewModelScope.launch {
            tmdbClient.clearAllCache()
            refreshTmdbCache()
        }
    }

    /** Svuota la cache immagini Coil (memory + disk). */
    fun clearImageCache() {
        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                imageLoader.memoryCache?.clear()
                imageLoader.diskCache?.clear()
            }
            refreshImageCache()
        }
    }

    /** Svuota streaming + TMDB + immagini (NON i download). */
    fun clearAllCaches() {
        viewModelScope.launch {
            clearStreamingCache()
            tmdbClient.clearAllCache()
            withContext(Dispatchers.IO) {
                imageLoader.memoryCache?.clear()
                imageLoader.diskCache?.clear()
            }
            refreshAll()
        }
    }

    fun setCacheEnabled(value: Boolean) {
        viewModelScope.launch { settings.setTmdbCacheEnabled(value) }
    }

    /** Trash a single download: stop work, wipe cached segments, drop the DB row. */
    fun remove(entry: DownloadEntry) {
        viewModelScope.launch { purge(entry) }
    }

    /** Bulk trash every entry whose id is in [ids] (multi-select). */
    fun removeMany(ids: Collection<Int>) {
        if (ids.isEmpty()) return
        viewModelScope.launch {
            val byId = entries.value.associateBy { it.id }
            ids.forEach { id -> byId[id]?.let { purge(it) } }
        }
    }

    private suspend fun purge(entry: DownloadEntry) {
        ResolveAndDownloadWorker.cancel(app, entry.id)
        withContext(Dispatchers.IO) {
            ResolveAndDownloadWorker.removeCachedData(entry.streamUrl)
        }
        repository.removeDownload(entry.id)
        queueManager.advance()
    }
}