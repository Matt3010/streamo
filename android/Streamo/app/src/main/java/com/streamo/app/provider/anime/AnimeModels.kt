package com.streamo.app.provider.anime

import com.google.gson.annotations.SerializedName

/**
 * Wire + domain types for the AnimeUnity provider. AnimeUnity is a native
 * catalog (its own ids, no TMDB) surfaced in the dedicated "Anime" tab.
 * The JSON endpoints (`/livesearch`, `/archivio/get-animes`, `/info_api`) are
 * consumed directly via Gson. Port of iOS `AnimeUnityModels.swift`.
 */

/**
 * A catalog entry (one cour/season — AnimeUnity models each as a separate
 * record). `id` + `slug` form the `/anime/{id}-{slug}` path.
 */
data class AUAnime(
    val id: Int,
    val slug: String?,
    /** `title` is often null; `title_eng` is the reliable display name. */
    val title: String?,
    @SerializedName("title_eng") val titleEng: String?,
    @SerializedName("title_it") val titleIt: String?,
    /** TV | Movie | OVA | ONA | Special */
    val type: String?,
    @SerializedName("episodes_count") val episodesCount: Int?,
    val imageurl: String?,
    @SerializedName("imageurl_cover") val imageurlCover: String?,
    val plot: String?,
    /** Release year as string, e.g. "2002". */
    val date: String?,
    /** "In corso" | "Terminato". */
    val status: String?,
    /** 0 = sub ita, 1 = dub ita. */
    val dub: Int?,
    val score: String?,
    val studio: String?,
    @SerializedName("mal_id") val malId: Int?,
    @SerializedName("anilist_id") val anilistId: Int?
) {
    /** Best human-facing name (title_eng → title_it → title → slug). */
    val displayTitle: String
        get() = listOf(titleEng, titleIt, title)
            .firstOrNull { !it.isNullOrBlank() }
            ?.trim()
            ?: slug
            ?: "Anime $id"

    /** Release year parsed from `date`. */
    val year: Int? get() = date?.take(4)?.toIntOrNull()

    val isDubbed: Boolean get() = (dub ?: 0) == 1

    companion object {
        /**
         * Minimal entry reconstructed from a saved continue-watching row — enough
         * to push the detail page, which re-fetches episodes by id.
         */
        fun stub(id: Int, title: String?, slug: String?, imageurl: String?) = AUAnime(
            id = id, slug = slug, title = title, titleEng = null, titleIt = null,
            type = null, episodesCount = null, imageurl = imageurl, imageurlCover = null,
            plot = null, date = null, status = null, dub = null, score = null,
            studio = null, malId = null, anilistId = null
        )
    }
}

/**
 * One episode within an [AUAnime]. `scwsId` is the vixcloud stream id; `id` is
 * the AnimeUnity episode id used by `/embed-url/{id}`.
 */
data class AUEpisode(
    val id: Int,
    /** Episode number — AnimeUnity sends it as a string ("1", "12.5", …). */
    val number: String?,
    @SerializedName("scws_id") val scwsId: Int?,
    @SerializedName("file_name") val fileName: String?
) {
    /** Integer episode number when parseable (drops fractional specials). */
    val numberInt: Int? get() = number?.toIntOrNull()
}

// region Endpoint responses

/** `POST /livesearch` and `POST /archivio/get-animes` both wrap records. */
data class AURecordsResponse(
    val records: List<AUAnime>?,
    val tot: Int?
)

/** `GET /info_api/{animeId}/1?start_range&end_range`. */
data class AUInfoResponse(
    @SerializedName("episodes_count") val episodesCount: Int?,
    @SerializedName("current_episode") val currentEpisode: Int?,
    val episodes: List<AUEpisode>?
)

/** One window of episodes plus the entry's total count. */
data class AUEpisodePage(
    val episodes: List<AUEpisode>,
    val total: Int
)

// endregion