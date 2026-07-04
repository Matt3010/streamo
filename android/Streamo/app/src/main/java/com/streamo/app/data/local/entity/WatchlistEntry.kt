package com.streamo.app.data.local.entity

import androidx.room.Entity

@Entity(tableName = "watchlist", primaryKeys = ["tmdbId", "mediaType"])
data class WatchlistEntry(
    val tmdbId: Int,
    val mediaType: String, // "movie" or "tv"
    val title: String,
    val posterPath: String?,
    val addedAt: Long = System.currentTimeMillis()
)
