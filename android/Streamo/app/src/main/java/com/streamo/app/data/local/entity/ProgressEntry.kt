package com.streamo.app.data.local.entity

import androidx.room.Entity

@Entity(
    tableName = "progress",
    primaryKeys = ["tmdbId", "mediaType", "season", "episode"]
)
data class ProgressEntry(
    val tmdbId: Int,
    val mediaType: String,
    val season: Int = 0,
    val episode: Int = 0,
    val positionSeconds: Double = 0.0,
    val durationSeconds: Double = 0.0,
    val title: String = "",
    val posterPath: String? = null,
    val updatedAt: Long = System.currentTimeMillis(),
    /** AnimeUnity episode id (per riprendere senza ri-scaricare la pagina dettaglio). Null per TMDB. */
    val providerEpisodeId: Int? = null,
    /** Slug AnimeUnity per l'header Referer dell'embed. Null per TMDB. */
    val providerSlug: String? = null
)
