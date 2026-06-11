package com.streamo.app.data.remote.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class TmdbGenre(
    val id: Int,
    val name: String
)

@Serializable
data class TmdbCastMember(
    val id: Int,
    val name: String,
    val character: String? = null,
    val order: Int? = null,
    @SerialName("profile_path")
    val profilePath: String? = null
)

@Serializable
data class TmdbCredits(
    val cast: List<TmdbCastMember>? = null
)

@Serializable
data class TmdbVideo(
    val id: String,
    val key: String? = null,
    val name: String? = null,
    val site: String? = null,
    val type: String? = null,
    val official: Boolean? = null,
    @SerialName("published_at")
    val publishedAt: String? = null
)

@Serializable
data class TmdbVideoCollection(
    val results: List<TmdbVideo>? = null
)

@Serializable
data class TmdbEpisodeRef(
    @SerialName("season_number")
    val seasonNumber: Int? = null,
    @SerialName("episode_number")
    val episodeNumber: Int? = null,
    @SerialName("air_date")
    val airDate: String? = null
)

@Serializable
data class TmdbSeasonInfo(
    @SerialName("season_number")
    val seasonNumber: Int,
    @SerialName("episode_count")
    val episodeCount: Int? = null,
    val name: String? = null,
    @SerialName("air_date")
    val airDate: String? = null
)

@Serializable
data class TmdbEpisodeDetail(
    @SerialName("episode_number")
    val episodeNumber: Int,
    @SerialName("season_number")
    val seasonNumber: Int? = null,
    val name: String? = null,
    val overview: String? = null,
    @SerialName("still_path")
    val stillPath: String? = null,
    @SerialName("air_date")
    val airDate: String? = null,
    val runtime: Int? = null
) {
    companion object {
        fun stub(number: Int): TmdbEpisodeDetail =
            TmdbEpisodeDetail(
                episodeNumber = number,
                seasonNumber = null,
                name = null,
                overview = null,
                stillPath = null,
                airDate = null,
                runtime = null
            )
    }
}

@Serializable
data class TmdbSeasonDetails(
    val episodes: List<TmdbEpisodeDetail>? = null
)

@Serializable
data class TmdbReviewAuthorDetails(
    val username: String? = null,
    val name: String? = null,
    @SerialName("avatar_path")
    val avatarPath: String? = null,
    val rating: Double? = null
)

@Serializable
data class TmdbReview(
    val id: String,
    val author: String,
    val content: String,
    @SerialName("created_at")
    val createdAt: String? = null,
    @SerialName("updated_at")
    val updatedAt: String? = null,
    val url: String? = null,
    @SerialName("author_details")
    val authorDetails: TmdbReviewAuthorDetails? = null
)

@Serializable
data class TmdbGenreListResponse(
    val genres: List<TmdbGenre>
)

@Serializable
data class TmdbItem(
    val id: Int,
    @SerialName("media_type")
    val mediaType: String? = null,
    val title: String? = null,
    val name: String? = null,
    @SerialName("poster_path")
    val posterPath: String? = null,
    @SerialName("backdrop_path")
    val backdropPath: String? = null,
    val popularity: Double? = null,
    @SerialName("vote_average")
    val voteAverage: Double? = null,
    @SerialName("vote_count")
    val voteCount: Int? = null,
    @SerialName("release_date")
    val releaseDate: String? = null,
    @SerialName("first_air_date")
    val firstAirDate: String? = null,
    val overview: String? = null,
    val tagline: String? = null,
    val runtime: Int? = null,
    @SerialName("episode_run_time")
    val episodeRunTime: List<Int>? = null,
    @SerialName("number_of_seasons")
    val numberOfSeasons: Int? = null,
    @SerialName("number_of_episodes")
    val numberOfEpisodes: Int? = null,
    val status: String? = null,
    val genres: List<TmdbGenre>? = null,
    val credits: TmdbCredits? = null,
    val videos: TmdbVideoCollection? = null,
    val seasons: List<TmdbSeasonInfo>? = null,
    @SerialName("last_episode_to_air")
    val lastEpisodeToAir: TmdbEpisodeRef? = null,
    @SerialName("genre_ids")
    val genreIds: List<Int>? = null,
    @SerialName("next_episode_to_air")
    val nextEpisodeToAir: TmdbEpisodeRef? = null
) {
    val displayTitle: String get() = title ?: name ?: ""
    val primaryDate: String? get() = releaseDate ?: firstAirDate
    val year: Int?
        get() = primaryDate?.takeIf { it.length >= 4 }?.substring(0, 4)?.toIntOrNull()
}

@Serializable
data class TmdbListResponse<T>(
    val results: List<T>? = null
)
