package com.streamo.app.data.repository

import com.streamo.app.data.local.dao.DownloadDao
import com.streamo.app.data.local.dao.HistoryDao
import com.streamo.app.data.local.dao.ProgressDao
import com.streamo.app.data.local.dao.ProviderMappingDao
import com.streamo.app.data.local.dao.SearchHistoryDao
import com.streamo.app.data.local.dao.WatchlistDao
import com.streamo.app.data.local.entity.DownloadEntry
import com.streamo.app.data.local.entity.HistoryEntry
import com.streamo.app.data.local.entity.ProgressEntry
import com.streamo.app.data.local.entity.ProviderMappingEntity
import com.streamo.app.data.local.entity.SearchHistoryEntry
import com.streamo.app.data.local.entity.WatchlistEntry
import com.streamo.app.download.ResolveAndDownloadWorker
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AppRepository @Inject constructor(
    private val watchlistDao: WatchlistDao,
    private val progressDao: ProgressDao,
    private val historyDao: HistoryDao,
    private val providerMappingDao: ProviderMappingDao,
    private val downloadDao: DownloadDao,
    private val searchHistoryDao: SearchHistoryDao
) {
    // Watchlist
    fun watchlist(): Flow<List<WatchlistEntry>> = watchlistDao.getAll()
    suspend fun isInWatchlist(id: Int) = watchlistDao.getById(id) != null
    fun watchlistExistsFlow(id: Int): Flow<Boolean> = watchlistDao.exists(id)
    suspend fun addToWatchlist(entry: WatchlistEntry) = watchlistDao.insert(entry)
    suspend fun removeFromWatchlist(id: Int) = watchlistDao.deleteById(id)

    // Progress
    fun progress(): Flow<List<ProgressEntry>> = progressDao.getAll()
    suspend fun getProgress(id: Int) = progressDao.getById(id)
    suspend fun getProgressByCoordinate(id: Int, mediaType: String, season: Int, episode: Int) =
        progressDao.getByCoordinate(id, mediaType, season, episode)
    suspend fun getLatestProgressForTitle(id: Int, mediaType: String) =
        progressDao.getLatestForTitle(id, mediaType)
    suspend fun getProgressForSeason(id: Int, mediaType: String, season: Int) =
        progressDao.getBySeason(id, mediaType, season)
    suspend fun saveProgress(entry: ProgressEntry) = progressDao.insert(entry)
    suspend fun deleteProgress(id: Int) = progressDao.deleteById(id)

    // History
    fun history(): Flow<List<HistoryEntry>> = historyDao.getAll()
    suspend fun addToHistory(entry: HistoryEntry) = historyDao.insert(entry)
    suspend fun removeFromHistory(entry: HistoryEntry) =
        historyDao.deleteByCoordinate(entry.tmdbId, entry.mediaType, entry.season, entry.episode, entry.watchedDay)

    suspend fun removeHistoryByTitle(tmdbId: Int, mediaType: String) =
        historyDao.deleteByTitle(tmdbId, mediaType)

    // Provider mapping
    suspend fun getProviderMapping(id: Int) = providerMappingDao.getById(id)
    suspend fun saveProviderMapping(mapping: ProviderMappingEntity) = providerMappingDao.insert(mapping)
    suspend fun deleteProviderMapping(id: Int) = providerMappingDao.deleteById(id)

    // Downloads
    fun downloads(): Flow<List<DownloadEntry>> = downloadDao.getAll()
    suspend fun addDownload(entry: DownloadEntry): Long = downloadDao.insert(entry)
    suspend fun removeDownload(id: Int) = downloadDao.deleteById(id)
    suspend fun getDownloadById(id: Int): DownloadEntry? = downloadDao.getById(id)
    suspend fun getDownloadByContentId(contentId: String): DownloadEntry? = downloadDao.getByContentId(contentId)
    fun downloadsForTmdbId(tmdbId: Int): Flow<List<DownloadEntry>> = downloadDao.getByTmdbId(tmdbId)
    suspend fun updateDownloadStatus(id: Int, status: String) = downloadDao.updateStatus(id, status)
    suspend fun updateDownloadStatusResetSpeed(id: Int, status: String) =
        downloadDao.updateStatusAndResetSpeed(id, status)
    suspend fun updateDownloadContentAndStatus(id: Int, contentId: String, streamUrl: String, status: String) =
        downloadDao.updateContentAndStatus(id, contentId, streamUrl, status)

    suspend fun updateDownloadContentStatusAndWarp(id: Int, contentId: String, streamUrl: String, streamHeaders: String, status: String, warpEnabled: Boolean) =
        downloadDao.updateContentStatusAndWarp(id, contentId, streamUrl, streamHeaders, status, warpEnabled)

    suspend fun getPendingOrderedByCreation(): List<DownloadEntry> =
        downloadDao.getPendingOrderedByCreation()

    /**
     * Sceglie il prossimo download pending in base a WARP mode.
     * Dà priorità a download con warpEnabled == currentWarpEnabled;
     * fallback al piú vecchio pending. Ignora entry con retryCount >= MAX_RETRIES.
     */
    suspend fun pickNextPendingDownload(currentWarpEnabled: Boolean): DownloadEntry? {
        val pending = getPendingOrderedByCreation()
            .filter { it.retryCount < ResolveAndDownloadWorker.MAX_RETRIES }
        // Priority: matching WARP state, then any
        val matching = pending.firstOrNull { it.warpEnabled == currentWarpEnabled }
        return matching ?: pending.firstOrNull()
    }

    suspend fun getActiveDownloads(): List<DownloadEntry> = downloadDao.getActiveDownloads()
    fun observeActiveDownloads(): Flow<List<DownloadEntry>> = downloadDao.observeActiveDownloads()
    fun observeFailedDownloadsCount(): Flow<Int> = downloadDao.observeFailedCount()

    suspend fun updateDownloadProgress(id: Int, percentage: Float, downloaded: Long, total: Long, speed: Long, status: String) =
        downloadDao.updateProgress(id, percentage, downloaded, total, speed, status)

    suspend fun markDownloadFailed(id: Int, errorMessage: String?) =
        downloadDao.markFailed(id, errorMessage)

    suspend fun updateDownloadPosterPath(id: Int, posterPath: String?) =
        downloadDao.updatePosterPath(id, posterPath)

    suspend fun updateDownloadStillPath(id: Int, stillPath: String?) =
        downloadDao.updateStillPath(id, stillPath)

    suspend fun updateDownloadQuality(id: Int, quality: String) =
        downloadDao.updateQuality(id, quality)

    suspend fun incrementRetryAndReset(id: Int) =
        downloadDao.incrementRetryAndReset(id)

    suspend fun resetRetryCount(id: Int) =
        downloadDao.resetRetryCount(id)

    // Search history
    fun searchHistory() = searchHistoryDao.getRecent()
    suspend fun addSearchQuery(entry: SearchHistoryEntry) {
        searchHistoryDao.insert(entry)
        searchHistoryDao.trim()
    }
    suspend fun removeSearchQuery(query: String) = searchHistoryDao.delete(query)
}