package com.streamo.provider.sdk

import kotlinx.serialization.Serializable

/** Identity of a streaming-provider extension. */
@Serializable
data class ProviderMetadata(
    val id: String,
    val name: String,
    val version: String
)

/**
 * The contract a streaming-provider extension implements: turn a TMDB title into
 * a playable HLS source. The catalog host depends only on this interface, never
 * on a concrete provider — so a provider can be the built-in StreamingCommunity
 * impl today, or a separately-installed extension APK tomorrow, without the host
 * changing.
 *
 * Host-side concerns (Room persistence of confirmed mappings, UI availability
 * state) live in the host, NOT here — see ProviderMappingStore / ProviderManager
 * in the app module.
 */
interface StreamProvider {

    val metadata: ProviderMetadata

    /** Resolve (or reuse a cached) provider title for a TMDB id. */
    suspend fun resolveTitle(
        tmdbId: Int,
        mediaType: String,
        title: String,
        releaseDate: String?,
        forceRefresh: Boolean = false
    ): ProviderResolveTitleOutcome

    /** Resolve a movie to playable HLS sources. */
    suspend fun movieSource(
        tmdbId: Int,
        title: String,
        releaseDate: String?
    ): PlaybackResolution

    /** Resolve a TV episode to playable HLS sources. */
    suspend fun episodeSource(
        tmdbId: Int,
        title: String,
        releaseDate: String?,
        season: Int,
        episode: Int
    ): PlaybackResolution

    /** Manually pin a candidate as the resolved title (provider picker). */
    fun confirmCandidate(candidate: ProviderCandidate, tmdbId: Int, mediaType: String)

    /** Seed the in-session cache from a known/persisted mapping so a confirmed
     * title is reused without re-searching. */
    fun prime(tmdbId: Int, mediaType: String, outcome: ProviderResolveTitleOutcome)

    /** Drop the cached title outcome (forces the next resolve to re-search). */
    fun invalidate(tmdbId: Int, mediaType: String)
}
