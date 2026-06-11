package com.streamo.app.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.streamo.app.data.local.entity.ProviderMappingEntity

@Dao
interface ProviderMappingDao {
    @Query("SELECT * FROM provider_mapping WHERE tmdbId = :id LIMIT 1")
    suspend fun getById(id: Int): ProviderMappingEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(mapping: ProviderMappingEntity)

    @Query("DELETE FROM provider_mapping WHERE tmdbId = :id")
    suspend fun deleteById(id: Int)
}
