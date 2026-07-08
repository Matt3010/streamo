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

    /** Tab Anime: catalogo AnimeUnity (ricerca + browse paginato). */
    @Serializable
    data object Anime : NavRoutes()

    /** Dettaglio anime: griglia episodi a finestre da 120. I metadati
     *  (tipo/anno/stato/dub/trama) viaggiano qui perché AnimeUnity non ha un
     *  endpoint "anime per id": li abbiamo già nella card del catalogo. Dal
     *  "Continua a guardare" arrivano vuoti (0/null) — la pagina mostra il poco
     *  che ha. */
    @Serializable
    data class AnimeDetail(
        val animeId: Int,
        val slug: String? = null,
        val title: String? = null,
        val poster: String? = null,
        val type: String? = null,
        val year: Int = 0,            // 0 = sconosciuto
        val status: String? = null,
        val dub: Int = 0,             // 1 = doppiato ITA
        val plot: String? = null
    ) : NavRoutes()

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

    /** Settings sub-screen: streaming/download cache management (size + clear). */
    @Serializable
    data object CacheManagement : NavRoutes()

    @Serializable
    data class AdvancedSettings(val scrollToWarp: Boolean = false) : NavRoutes()

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
        val releaseDate: String? = null,
        /** AnimeUnity episode id (risolve l'embed vixcloud). 0 = non-anime. */
        val animeEpisodeId: Int = 0,
        /** Slug AnimeUnity per l'header Referer dell'embed. null = non-anime. */
        val animeSlug: String? = null
    ) : NavRoutes()

    @Serializable
    data object DebugLogs : NavRoutes()
}
