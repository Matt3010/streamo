package com.streamo.app.data.local.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.streamo.app.data.local.entity.WatchlistEntry
import kotlinx.coroutines.flow.Flow

@Dao
interface WatchlistDao {
    @Query("SELECT * FROM watchlist ORDER BY addedAt DESC")
    fun getAll(): Flow<List<WatchlistEntry>>

    @Query("SELECT * FROM watchlist WHERE tmdbId = :id AND mediaType = :mediaType LIMIT 1")
    suspend fun getByKey(id: Int, mediaType: String): WatchlistEntry?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entry: WatchlistEntry)

    @Delete
    suspend fun delete(entry: WatchlistEntry)

    @Query("DELETE FROM watchlist WHERE tmdbId = :id AND mediaType = :mediaType")
    suspend fun deleteByKey(id: Int, mediaType: String)

    @Query("SELECT EXISTS(SELECT 1 FROM watchlist WHERE tmdbId = :id AND mediaType = :mediaType)")
    fun existsByKey(id: Int, mediaType: String): Flow<Boolean>
}
