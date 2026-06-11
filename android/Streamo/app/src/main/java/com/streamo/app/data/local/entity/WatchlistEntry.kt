package com.streamo.app.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "watchlist")
data class WatchlistEntry(
    @PrimaryKey val tmdbId: Int,
    val mediaType: String, // "movie" or "tv"
    val title: String,
    val posterPath: String?,
    val addedAt: Long = System.currentTimeMillis()
)
