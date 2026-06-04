package com.streamo.app.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.streamo.app.data.local.entity.ProgressEntry
import kotlinx.coroutines.flow.Flow

@Dao
interface ProgressDao {
    @Query("SELECT * FROM progress ORDER BY updatedAt DESC")
    fun getAll(): Flow<List<ProgressEntry>>

    @Query("SELECT * FROM progress WHERE tmdbId = :id ORDER BY updatedAt DESC LIMIT 1")
    suspend fun getById(id: Int): ProgressEntry?

    @Query("SELECT * FROM progress WHERE tmdbId = :id AND mediaType = :mediaType AND season = :season AND episode = :episode LIMIT 1")
    suspend fun getByCoordinate(id: Int, mediaType: String, season: Int, episode: Int): ProgressEntry?

    @Query("SELECT * FROM progress WHERE tmdbId = :id AND mediaType = :mediaType ORDER BY updatedAt DESC LIMIT 1")
    suspend fun getLatestForTitle(id: Int, mediaType: String): ProgressEntry?

    @Query("SELECT * FROM progress WHERE tmdbId = :id AND mediaType = :mediaType AND season = :season")
    suspend fun getBySeason(id: Int, mediaType: String, season: Int): List<ProgressEntry>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entry: ProgressEntry)

    @Query("DELETE FROM progress WHERE tmdbId = :id")
    suspend fun deleteById(id: Int)
}
