package com.streamo.provider.sdk

import kotlinx.serialization.Serializable

/**
 * Provider-neutral domain types shared between the catalog host and any
 * streaming-provider extension (StreamingCommunity today, Jellyfin etc. later).
 *
 * These intentionally carry NO provider-specific wire detail (no Gson/Inertia
 * payloads) — those stay private to each provider implementation. They are
 * `@Serializable` so they can cross the AIDL boundary as JSON (see [ProviderJson]).
 */

/** A confirmed provider title mapped to a TMDB id. */
@Serializable
data class ProviderResolvedTitle(
    val id: Int,
    val slug: String?,
    val title: String,
    val mediaType: String // "movie" or "tv"
)

/** A picker candidate (weak / alternative matches). */
@Serializable
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
@Serializable
data class ProviderResolveTitleOutcome(
    val resolved: ProviderResolvedTitle?,
    val reason: ProviderResolveFailureReason?,
    val candidates: List<ProviderCandidate>,
    val matchStatus: ProviderMatchStatus?
)

/** Outcome of resolving a movie/episode embed. */
@Serializable
data class ProviderEmbedOutcome(
    val embedUrl: String?,
    val reason: ProviderResolveFailureReason?
)

/** A playable HLS source with required headers. */
@Serializable
data class PlaybackSource(
    val playlistUrl: String,
    val headers: Map<String, String>
)

/** Full result of resolving a title to playable sources. */
@Serializable
data class PlaybackResolution(
    val sources: List<PlaybackSource>,
    val reason: ProviderResolveFailureReason?,
    val message: String?,
    val providerTitle: ProviderResolvedTitle?,
    val candidates: List<ProviderCandidate>,
    /** Whether sources were resolved through a proxy (drives the player's choice
     * of a proxied DataSource and the WARP/Diretto badge). */
    val viaProxy: Boolean = false
)
