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

    @Query("SELECT * FROM history WHERE tmdbId = :id LIMIT 1")
    suspend fun getById(id: Int): HistoryEntry?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entry: HistoryEntry)

    @Query("DELETE FROM history WHERE tmdbId = :id")
    suspend fun deleteById(id: Int)
}
