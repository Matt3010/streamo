package com.streamo.provider.streamingcommunity

import com.streamo.provider.sdk.PlaybackResolution
import com.streamo.provider.sdk.ProviderCandidate
import com.streamo.provider.sdk.ProviderEmbedOutcome
import com.streamo.provider.sdk.ProviderMatchStatus
import com.streamo.provider.sdk.ProviderResolveFailureReason
import com.streamo.provider.sdk.ProviderResolveTitleOutcome
import com.streamo.provider.sdk.ProviderResolvedTitle
import okhttp3.OkHttpClient
import java.net.InetSocketAddress
import java.net.Proxy

/**
 * StreamingCommunity resolution orchestration that runs inside the extension
 * process. Equivalent to the host's former `ProviderResolver`, but instead of
 * owning a WARP tunnel it receives the host's WARP loopback proxy port per call
 * (`useProxy`/`proxyPort`) and routes the SC/vixcloud HTTP through it, so the
 * vixcloud token binds to the same egress IP the host fetches media with.
 */
class ScResolver(private val baseClient: OkHttpClient) {

    private val provider = ProviderClient(baseClient)
    private val vix = VixcloudClient(baseClient)

    private val titleCache = mutableMapOf<String, ProviderResolveTitleOutcome>()

    @Volatile private var proxiedPort: Int = 0
    @Volatile private var proxiedClient: OkHttpClient? = null

    private fun cacheKey(id: Int, type: String, useProxy: Boolean) =
        "$type:$id:${if (useProxy) "proxy" else "local"}"

    private fun cacheKeysForAllModes(id: Int, type: String) =
        listOf(cacheKey(id, type, false), cacheKey(id, type, true))

    /** Point the provider/vix clients at the host's WARP loopback proxy (or
     * direct) and set the search locale, before each resolve. */
    private fun applyContext(useProxy: Boolean, proxyPort: Int, locale: String) {
        provider.locale = locale.ifBlank { "it" }
        if (useProxy && proxyPort > 0) {
            val client = proxiedClient?.takeIf { proxiedPort == proxyPort } ?: OkHttpClient.Builder()
                .proxy(Proxy(Proxy.Type.HTTP, InetSocketAddress("127.0.0.1", proxyPort)))
                .build()
                .also { proxiedClient = it; proxiedPort = proxyPort }
            provider.setClient(client)
            vix.setClient(client)
            ProviderDebugLogger.log("ScResolver: routing through host WARP proxy 127.0.0.1:$proxyPort")
        } else {
            provider.resetClient()
            vix.resetClient()
        }
    }

    fun prime(tmdbId: Int, mediaType: String, outcome: ProviderResolveTitleOutcome) {
        for (key in cacheKeysForAllModes(tmdbId, mediaType)) titleCache[key] = outcome
    }

    fun invalidate(tmdbId: Int, mediaType: String) {
        for (key in cacheKeysForAllModes(tmdbId, mediaType)) titleCache.remove(key)
    }

    fun confirmCandidate(candidate: ProviderCandidate, tmdbId: Int, mediaType: String) {
        val resolved = ProviderResolvedTitle(
            id = candidate.providerTitleId,
            slug = candidate.providerSlug,
            title = candidate.title,
            mediaType = mediaType
        )
        val existing = cacheKeysForAllModes(tmdbId, mediaType)
            .firstNotNullOfOrNull { titleCache[it]?.candidates?.takeIf { c -> c.isNotEmpty() } }
            ?: emptyList()
        val outcome = ProviderResolveTitleOutcome(
            resolved = resolved,
            reason = null,
            candidates = existing,
            matchStatus = ProviderMatchStatus.MANUAL_CONFIRMED
        )
        for (key in cacheKeysForAllModes(tmdbId, mediaType)) titleCache[key] = outcome
    }

    suspend fun resolveTitle(
        tmdbId: Int,
        mediaType: String,
        title: String,
        releaseDate: String?,
        forceRefresh: Boolean,
        useProxy: Boolean,
        proxyPort: Int,
        locale: String
    ): ProviderResolveTitleOutcome {
        applyContext(useProxy, proxyPort, locale)
        return resolveTitleInternal(tmdbId, mediaType, title, releaseDate, forceRefresh, useProxy)
    }

    private suspend fun resolveTitleInternal(
        tmdbId: Int,
        mediaType: String,
        title: String,
        releaseDate: String?,
        forceRefresh: Boolean,
        useProxy: Boolean
    ): ProviderResolveTitleOutcome {
        val key = cacheKey(tmdbId, mediaType, useProxy)
        if (!forceRefresh) titleCache[key]?.let { return it }
        val outcome = provider.resolveTitle(tmdbId, mediaType, title, releaseDate)
        titleCache[key] = outcome
        return outcome
    }

    suspend fun movieSource(
        tmdbId: Int,
        title: String,
        releaseDate: String?,
        useProxy: Boolean,
        proxyPort: Int,
        locale: String
    ): PlaybackResolution {
        applyContext(useProxy, proxyPort, locale)
        val outcome = resolveTitleInternal(tmdbId, "movie", title, releaseDate, forceRefresh = false, useProxy = useProxy)
        val resolved = outcome.resolved ?: return unresolved(outcome, useProxy)
        val embed = provider.movieEmbed(resolved.id)
        return finalize(embed, resolved, outcome.candidates, useProxy)
    }

    suspend fun episodeSource(
        tmdbId: Int,
        title: String,
        releaseDate: String?,
        season: Int,
        episode: Int,
        useProxy: Boolean,
        proxyPort: Int,
        locale: String
    ): PlaybackResolution {
        applyContext(useProxy, proxyPort, locale)
        val outcome = resolveTitleInternal(tmdbId, "tv", title, releaseDate, forceRefresh = false, useProxy = useProxy)
        val resolved = outcome.resolved ?: return unresolved(outcome, useProxy)
        val embed = provider.episodeEmbed(resolved.id, resolved.slug, season, episode)
        return finalize(embed, resolved, outcome.candidates, useProxy)
    }

    private fun unresolved(outcome: ProviderResolveTitleOutcome, useProxy: Boolean) = PlaybackResolution(
        sources = emptyList(),
        reason = outcome.reason ?: ProviderResolveFailureReason.NOT_FOUND,
        message = unavailableMessage(outcome.reason),
        providerTitle = null,
        candidates = outcome.candidates,
        viaProxy = useProxy
    )

    private suspend fun finalize(
        embed: ProviderEmbedOutcome,
        resolved: ProviderResolvedTitle,
        candidates: List<ProviderCandidate>,
        useProxy: Boolean
    ): PlaybackResolution {
        val embedUrl = embed.embedUrl ?: return PlaybackResolution(
            sources = emptyList(),
            reason = embed.reason ?: ProviderResolveFailureReason.NOT_FOUND,
            message = unavailableMessage(embed.reason),
            providerTitle = resolved,
            candidates = candidates,
            viaProxy = useProxy
        )
        return try {
            val sources = vix.playbackSources(embedUrl)
            PlaybackResolution(
                sources = sources,
                reason = null,
                message = null,
                providerTitle = resolved,
                candidates = candidates,
                viaProxy = useProxy
            )
        } catch (e: Exception) {
            ProviderDebugLogger.logError("ScResolver.finalize: vix.playbackSources failed", e)
            PlaybackResolution(
                sources = emptyList(),
                reason = ProviderResolveFailureReason.TEMPORARILY_UNAVAILABLE,
                message = e.message ?: "Riproduzione non disponibile.",
                providerTitle = resolved,
                candidates = candidates,
                viaProxy = useProxy
            )
        }
    }

    private fun unavailableMessage(reason: ProviderResolveFailureReason?): String = when (reason) {
        ProviderResolveFailureReason.TEMPORARILY_UNAVAILABLE -> "Riproduzione temporaneamente non disponibile"
        ProviderResolveFailureReason.UNRELEASED -> "Non ancora disponibile"
        else -> "Titolo non disponibile"
    }
}
