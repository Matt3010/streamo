package com.streamo.app.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "history")
data class HistoryEntry(
    @PrimaryKey val tmdbId: Int,
    val mediaType: String,
    val title: String,
    val posterPath: String?,
    val season: Int = 0,
    val episode: Int = 0,
    val watchedAt: Long = System.currentTimeMillis()
)
