package com.streamo.app.provider

import com.google.gson.*
import com.google.gson.reflect.TypeToken
import java.lang.reflect.Type

/**
 * Wire + domain types for the StreamingCommunity provider resolution.
 * Port of iOS ProviderModels.swift.
 */

// region Title resolution models

/** A confirmed StreamingCommunity title mapped to a TMDB id. */
data class ProviderResolvedTitle(
    val id: Int,
    val slug: String?,
    val title: String,
    val mediaType: String // "movie" or "tv"
)

/** A picker candidate (weak / alternative matches). */
data class ProviderCandidate(
    val providerTitleId: Int,
    val providerSlug: String?,
    val title: String,
    val year: Int?,
    val score: Int,
    val posterUrl: String? = null
)

enum class ProviderMatchStatus(val rawValue: String) {
    AUTO_CONFIRMED("auto_confirmed"),
    MANUAL_CONFIRMED("manual_confirmed"),
    FAILED("failed");

    companion object {
        fun fromRaw(value: String): ProviderMatchStatus =
            entries.find { it.rawValue == value } ?: FAILED
    }
}

enum class ProviderResolveFailureReason {
    NOT_FOUND,
    TEMPORARILY_UNAVAILABLE,
    UNRELEASED
}

/** Outcome of resolving a TMDB title to a provider title. */
data class ProviderResolveTitleOutcome(
    val resolved: ProviderResolvedTitle?,
    val reason: ProviderResolveFailureReason?,
    val candidates: List<ProviderCandidate>,
    val matchStatus: ProviderMatchStatus?
)

/** Outcome of resolving a movie/episode embed. */
data class ProviderEmbedOutcome(
    val embedUrl: String?,
    val reason: ProviderResolveFailureReason?
)

// endregion

// region Decodable payloads (Inertia data-page JSON)

/** Titles can arrive as a bare array or wrapped in { "data": [...] }. */
data class ProviderTitlesContainer(
    val titles: List<ProviderSearchTitle>
)

data class ProviderTranslation(
    val key: String?,
    val value: String?
)

data class ProviderSearchTitle(
    val id: Int?,
    val slug: String?,
    val name: String?,
    val type: String?,
    val lastAirDate: String?,
    val translations: List<ProviderTranslation>?
)

data class ProviderSearchPage(
    val props: Props?
) {
    data class Props(
        val titles: ProviderTitlesContainer?
    )
}

data class ProviderSeasonSummary(
    val id: Int?,
    val number: Int?,
    val episodesCount: Int?
)

data class ProviderEpisode(
    val id: Int?,
    val number: Int?,
    val scwsId: Int?,
    val seasonId: Int?
)

data class ProviderLoadedSeason(
    val id: Int?,
    val number: Int?,
    val episodes: List<ProviderEpisode>?
)

data class ProviderTitlePage(
    val props: Props?
) {
    data class Props(
        val title: TitleObj?,
        val loadedSeason: ProviderLoadedSeason?
    )

    data class TitleObj(
        val seasons: List<ProviderSeasonSummary>?
    )
}

// endregion

// region Telegraph API response

data class TelegraphResponse(
    val result: Result?
) {
    data class Result(
        val content: List<TelegraphNode>?
    )
}

data class TelegraphNode(
    val tag: String?,
    val attrs: Attrs?,
    val children: List<TelegraphChild>?
) {
    data class Attrs(
        val href: String?
    )
}

/** Telegraph child nodes can be plain text strings or nested nodes. */
sealed class TelegraphChild {
    data class Text(val value: String) : TelegraphChild()
    data class Node(val node: TelegraphNode) : TelegraphChild()
}

// endregion

// region Gson adapters

/**
 * Gson instance with custom deserializers that mirror the iOS
 * JSONDecoder behaviour for polymorphic / shape-variant payloads.
 */
object ProviderGson {
    val instance: Gson by lazy {
        GsonBuilder()
            .registerTypeAdapter(TelegraphChild::class.java, TelegraphChildDeserializer())
            .registerTypeAdapter(ProviderTitlesContainer::class.java, ProviderTitlesContainerDeserializer())
            .create()
    }
}

/** Telegraph content nodes can be raw strings or nested nodes. */
private class TelegraphChildDeserializer : JsonDeserializer<TelegraphChild> {
    override fun deserialize(
        json: JsonElement,
        typeOfT: Type,
        context: JsonDeserializationContext
    ): TelegraphChild {
        return if (json.isJsonPrimitive && json.asJsonPrimitive.isString) {
            TelegraphChild.Text(json.asString)
        } else {
            TelegraphChild.Node(context.deserialize(json, TelegraphNode::class.java))
        }
    }
}

/**
 * Titles can arrive as a bare array or wrapped in `{ "data": [...] }`.
 * Matches the iOS `ProviderTitlesContainer` custom `init(from decoder:)`.
 */
private class ProviderTitlesContainerDeserializer : JsonDeserializer<ProviderTitlesContainer> {
    override fun deserialize(
        json: JsonElement,
        typeOfT: Type,
        context: JsonDeserializationContext
    ): ProviderTitlesContainer {
        return when {
            json.isJsonArray -> {
                val list = context.deserialize<List<ProviderSearchTitle>>(
                    json,
                    object : TypeToken<List<ProviderSearchTitle>>() {}.type
                )
                ProviderTitlesContainer(list ?: emptyList())
            }
            json.isJsonObject -> {
                val dataArray = json.asJsonObject.getAsJsonArray("data")
                val list = if (dataArray != null) {
                    context.deserialize<List<ProviderSearchTitle>>(
                        dataArray,
                        object : TypeToken<List<ProviderSearchTitle>>() {}.type
                    )
                } else null
                ProviderTitlesContainer(list ?: emptyList())
            }
            else -> ProviderTitlesContainer(emptyList())
        }
    }
}

// endregion

// region Playback models

/** A playable HLS source with required headers. */
data class PlaybackSource(
    val playlistUrl: String,
    val headers: Map<String, String>
)

/** Full result of resolving a title to playable sources. */
data class PlaybackResolution(
    val sources: List<PlaybackSource>,
    val reason: ProviderResolveFailureReason?,
    val message: String?,
    val providerTitle: ProviderResolvedTitle?,
    val candidates: List<ProviderCandidate>,
    /** Whether sources were resolved through the WARP proxy (drives the player's
     * choice of a proxied DataSource and the WARP/Diretto badge). */
    val viaProxy: Boolean = false
)

// endregion