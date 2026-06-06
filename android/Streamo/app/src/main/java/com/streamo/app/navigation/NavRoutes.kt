package com.streamo.app.navigation

import kotlinx.serialization.Serializable

@Serializable
sealed class NavRoutes {
    @Serializable
    data object Home : NavRoutes()

    @Serializable
    data object Search : NavRoutes()

    @Serializable
    data object Watchlist : NavRoutes()

    @Serializable
    data class Detail(
        val tmdbId: Int,
        val mediaType: String,
        val resumeSeason: Int = 0,
        val resumeEpisode: Int = 0
    ) : NavRoutes()

    @Serializable
    data object History : NavRoutes()

    @Serializable
    data object Settings : NavRoutes()

    @Serializable
    data object Downloads : NavRoutes()

    @Serializable
    data class SeriesDownloads(
        val tmdbId: Int,
        val title: String,
        val showAllEpisodes: Boolean = false
    ) : NavRoutes()

    @Serializable
    data object ContinueWatching : NavRoutes()

    /** TV-only: collapsed Watchlist + History + Continue Watching. */
    @Serializable
    data object Library : NavRoutes()

    @Serializable
    data class SectionList(
        val title: String,
        val endpoint: String,
        val mediaType: String
    ) : NavRoutes()

    @Serializable
    data class Player(
        val tmdbId: Int,
        val mediaType: String,
        val resumeSeason: Int = 0,
        val resumeEpisode: Int = 0,
        val title: String = "",
        val poster: String? = null,
        val releaseDate: String? = null
    ) : NavRoutes()
}
