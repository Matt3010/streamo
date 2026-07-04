package com.streamo.app.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.streamo.app.data.local.entity.TmdbCacheEntry

@Dao
interface TmdbCacheDao {
    @Query("SELECT * FROM tmdb_cache WHERE key = :key LIMIT 1")
    suspend fun get(key: String): TmdbCacheEntry?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entry: TmdbCacheEntry)

    @Query("SELECT COUNT(*) FROM tmdb_cache")
    suspend fun count(): Int

    @Query("SELECT COALESCE(SUM(LENGTH(payload)), 0) FROM tmdb_cache")
    suspend fun bytes(): Long

    @Query("SELECT COALESCE(SUM(LENGTH(payload)), 0) FROM tmdb_cache WHERE type = :type")
    suspend fun bytesByType(type: String): Long

    @Query("SELECT COUNT(*) FROM tmdb_cache WHERE type = :type")
    suspend fun countByType(type: String): Int

    @Query("DELETE FROM tmdb_cache WHERE type = :type")
    suspend fun deleteByType(type: String): Int

    @Query("DELETE FROM tmdb_cache")
    suspend fun deleteAll(): Int

    @Query("DELETE FROM tmdb_cache WHERE fetchedAt + ttlSeconds * 1000 < :now")
    suspend fun deleteExpired(now: Long = System.currentTimeMillis()): Int
}