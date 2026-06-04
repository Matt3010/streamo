package com.streamo.app.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.streamo.app.data.local.entity.DownloadEntry
import kotlinx.coroutines.flow.Flow

@Dao
interface DownloadDao {
    @Query("SELECT * FROM downloads ORDER BY createdAt DESC")
    fun getAll(): Flow<List<DownloadEntry>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entry: DownloadEntry): Long

    @Query("DELETE FROM downloads WHERE id = :id")
    suspend fun deleteById(id: Int)

    @Query("SELECT * FROM downloads WHERE id = :id LIMIT 1")
    suspend fun getById(id: Int): DownloadEntry?

    @Query("SELECT * FROM downloads WHERE contentId = :contentId LIMIT 1")
    suspend fun getByContentId(contentId: String): DownloadEntry?

    @Query("SELECT * FROM downloads WHERE tmdbId = :tmdbId ORDER BY season ASC, episode ASC")
    fun getByTmdbId(tmdbId: Int): Flow<List<DownloadEntry>>

    @Query("SELECT * FROM downloads WHERE status IN ('pending', 'downloading', 'paused', 'resolving') ORDER BY createdAt ASC")
    suspend fun getActiveDownloads(): List<DownloadEntry>

    @Query("UPDATE downloads SET status = :status WHERE id = :id")
    suspend fun updateStatus(id: Int, status: String)

    /** Cambia stato azzerando la velocità: evita di mostrare la velocità stale al resume. */
    @Query("UPDATE downloads SET status = :status, bytesPerSecond = 0 WHERE id = :id")
    suspend fun updateStatusAndResetSpeed(id: Int, status: String)

    @Query("UPDATE downloads SET contentId = :contentId, streamUrl = :streamUrl, status = :status WHERE id = :id")
    suspend fun updateContentAndStatus(id: Int, contentId: String, streamUrl: String, status: String)

    @Query("UPDATE downloads SET downloadPercentage = :percentage, bytesDownloaded = :downloaded, bytesTotal = :total, bytesPerSecond = :speed, status = :status WHERE id = :id")
    suspend fun updateProgress(id: Int, percentage: Float, downloaded: Long, total: Long, speed: Long, status: String)

    @Query("UPDATE downloads SET errorMessage = :errorMessage, status = 'failed' WHERE id = :id")
    suspend fun markFailed(id: Int, errorMessage: String?)

    @Query("UPDATE downloads SET retryCount = retryCount + 1, status = 'pending' WHERE id = :id")
    suspend fun incrementRetryAndReset(id: Int)

    @Query("UPDATE downloads SET retryCount = 0 WHERE id = :id")
    suspend fun resetRetryCount(id: Int)

    @Query("UPDATE downloads SET posterPath = :posterPath WHERE id = :id")
    suspend fun updatePosterPath(id: Int, posterPath: String?)

    @Query("UPDATE downloads SET stillPath = :stillPath WHERE id = :id")
    suspend fun updateStillPath(id: Int, stillPath: String?)

    @Query("UPDATE downloads SET quality = :quality WHERE id = :id")
    suspend fun updateQuality(id: Int, quality: String)
}