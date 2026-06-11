package com.streamo.app.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "downloads")
data class DownloadEntry(
    @PrimaryKey(autoGenerate = true) val id: Int = 0,
    val tmdbId: Int,
    val mediaType: String,
    val title: String,
    val season: Int = 0,
    val episode: Int = 0,
    val posterPath: String? = null,
    val stillPath: String? = null,
    val contentId: String = "",
    val streamUrl: String = "",
    val localPath: String = "",
    val quality: String? = null,
    val status: String = "pending", // pending, resolving, downloading, completed, failed, paused
    val downloadPercentage: Float = 0f,
    val bytesDownloaded: Long = 0L,
    val bytesTotal: Long = 0L,
    val bytesPerSecond: Long = 0L,
    val errorMessage: String? = null,
    val retryCount: Int = 0,
    val warpEnabled: Boolean = false,
    val createdAt: Long = System.currentTimeMillis()
)