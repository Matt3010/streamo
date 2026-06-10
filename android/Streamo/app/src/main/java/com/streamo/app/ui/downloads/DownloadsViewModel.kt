package com.streamo.app.ui.downloads

import android.app.Application
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.streamo.app.data.local.entity.DownloadEntry
import com.streamo.app.data.preferences.SettingsDataStore
import com.streamo.app.data.repository.AppRepository
import com.streamo.app.download.ResolveAndDownloadWorker
import com.streamo.app.tmdb.TMDBClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

@HiltViewModel
class DownloadsViewModel @Inject constructor(
    private val repository: AppRepository,
    private val settings: SettingsDataStore,
    private val app: Application,
    private val tmdbClient: TMDBClient
) : ViewModel() {

    val entries: StateFlow<List<DownloadEntry>> = repository.downloads()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    private val _warpChangedEntry = MutableStateFlow<Pair<DownloadEntry, Boolean>?>(null)
    val warpChangedEntry: StateFlow<Pair<DownloadEntry, Boolean>?> = _warpChangedEntry.asStateFlow()

    init {
        // Backfill posterPath + stillPath for legacy downloads that predate the fields.
        // Runs once per unique (tmdbId, mediaType, season) pair missing a poster, then
        // persists to Room so subsequent renders pick it up via the same flow.
        viewModelScope.launch {
            entries
                .map { list -> list.filter { it.posterPath.isNullOrBlank() || (it.mediaType == "tv" && it.stillPath.isNullOrBlank()) } }
                .distinctUntilChanged { a, b -> a.map { it.id } == b.map { it.id } }
                .collect { missing ->
                    val seenPoster = HashSet<Pair<Int, String>>()
                    val seenStill = HashSet<Triple<Int, Int, Int>>()
                    missing.forEach { entry ->
                        if (entry.posterPath.isNullOrBlank()) {
                            val key = entry.tmdbId to entry.mediaType
                            if (seenPoster.add(key)) enrichPoster(entry)
                        }
                        if (entry.mediaType == "tv" && entry.stillPath.isNullOrBlank() && entry.season > 0) {
                            val key = Triple(entry.tmdbId, entry.season, entry.episode)
                            if (seenStill.add(key)) enrichStill(entry)
                        }
                    }
                }
        }
    }

    private suspend fun enrichPoster(entry: DownloadEntry) {
        try {
            val detail = withContext(Dispatchers.IO) {
                tmdbClient.details(entry.tmdbId, entry.mediaType)
            }
            val path = detail.posterPath
            if (!path.isNullOrBlank()) {
                repository.updateDownloadPosterPath(entry.id, path)
            }
        } catch (t: Throwable) {
            Log.w("DownloadsVM", "Poster backfill failed for ${entry.tmdbId}", t)
        }
    }

    private suspend fun enrichStill(entry: DownloadEntry) {
        try {
            val season = withContext(Dispatchers.IO) {
                tmdbClient.seasonDetails(entry.tmdbId, entry.season)
            }
            val still = season.episodes?.firstOrNull { it.episodeNumber == entry.episode }?.stillPath
            if (!still.isNullOrBlank()) {
                repository.updateDownloadStillPath(entry.id, still)
            }
        } catch (t: Throwable) {
            Log.w("DownloadsVM", "Still backfill failed for ${entry.tmdbId} S${entry.season}E${entry.episode}", t)
        }
    }

    /**
     * Stop an active download WITHOUT deleting cached data, so it can be resumed.
     * Only the trash action ([remove]) wipes data.
     */
    fun stop(entry: DownloadEntry) {
        viewModelScope.launch {
            ResolveAndDownloadWorker.cancel(app, entry.id)
            repository.updateDownloadStatusResetSpeed(entry.id, "paused")
        }
    }

    /** Resume a stopped/failed download — checks if WARP state changed. */
    fun restart(entry: DownloadEntry) {
        viewModelScope.launch {
            val currentWarp = settings.warpEnabled.first()
            if (entry.warpEnabled != currentWarp && entry.streamUrl.isNotBlank()) {
                _warpChangedEntry.value = entry to currentWarp
                return@launch
            }
            doRestart(entry)
        }
    }

    /** Force restart even when WARP state changed (user confirmed dialog). */
    fun restartAnyway(entry: DownloadEntry) {
        _warpChangedEntry.value = null
        viewModelScope.launch { doRestart(entry) }
    }

    fun clearWarpWarning() { _warpChangedEntry.value = null }

    private suspend fun doRestart(entry: DownloadEntry) {
        repository.resetRetryCount(entry.id)
        repository.updateDownloadStatusResetSpeed(entry.id, "pending")
        ResolveAndDownloadWorker.enqueue(app, entry.id)
    }

    /** Trash: stop work, delete cached data from disk, then drop the DB row. */
    fun remove(entry: DownloadEntry) {
        viewModelScope.launch { purge(entry) }
    }

    /** Bulk trash: purge every entry whose id is in [ids]. Used by multi-select. */
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
    }
}
