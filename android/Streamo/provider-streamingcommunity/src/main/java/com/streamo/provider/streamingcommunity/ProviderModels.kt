package com.streamo.provider.streamingcommunity

import com.google.gson.*
import com.google.gson.reflect.TypeToken
import com.streamo.provider.sdk.*
import java.lang.reflect.Type

/**
 * StreamingCommunity-specific wire types (Inertia / Telegraph payloads + Gson
 * adapters). The provider-neutral domain types (ProviderResolvedTitle,
 * ProviderCandidate, PlaybackSource, PlaybackResolution, …) now live in the
 * shared :provider-api module (com.streamo.provider.sdk).
 * Port of iOS ProviderModels.swift.
 */

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