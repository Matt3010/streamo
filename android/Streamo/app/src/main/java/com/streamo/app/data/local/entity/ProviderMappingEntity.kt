package com.streamo.app.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "provider_mapping")
data class ProviderMappingEntity(
    @PrimaryKey val tmdbId: Int,
    val scId: Int,
    val scSlug: String,
    val scType: String,
    val scBaseUrl: String
)
