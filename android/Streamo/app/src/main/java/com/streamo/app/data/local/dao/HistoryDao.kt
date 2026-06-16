package com.streamo.app.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.streamo.app.data.local.entity.HistoryEntry
import kotlinx.coroutines.flow.Flow

@Dao
interface HistoryDao {
    @Query("SELECT * FROM history ORDER BY watchedAt DESC")
    fun getAll(): Flow<List<HistoryEntry>>

    @Query("SELECT * FROM history WHERE tmdbId = :id AND mediaType = :mediaType AND season = :season AND episode = :episode LIMIT 1")
    suspend fun getByCoordinate(id: Int, mediaType: String, season: Int, episode: Int): HistoryEntry?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entry: HistoryEntry)

    @Query("DELETE FROM history WHERE tmdbId = :id AND mediaType = :mediaType AND season = :season AND episode = :episode AND watchedDay = :watchedDay")
    suspend fun deleteByCoordinate(id: Int, mediaType: String, season: Int, episode: Int, watchedDay: Long)

    /** Removes every history row for a title (all episodes of a series or a movie). */
    @Query("DELETE FROM history WHERE tmdbId = :id AND mediaType = :mediaType")
    suspend fun deleteByTitle(id: Int, mediaType: String)
}
