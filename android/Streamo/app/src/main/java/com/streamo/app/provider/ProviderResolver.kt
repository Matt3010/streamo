package com.streamo.app.provider

import com.streamo.app.data.local.entity.ProviderMappingEntity
import com.streamo.app.data.preferences.SettingsDataStore
import com.streamo.app.data.repository.AppRepository
import com.streamo.app.provider.anime.AnimeUnityClient
import com.streamo.app.provider.warp.WarpTunnel
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Singleton

/**
 * High-level orchestration: TMDB title → provider title → episode/movie embed
 * → playable HLS source. Caches resolved titles in memory for the session;
 * durable persistence lives in Room `ProviderMappingEntity` and is wired by
 * the ViewModel.
 *
 * Port of iOS ProviderResolver.swift.
 */
@Singleton
class ProviderResolver @Inject constructor(
    private val provider: ProviderClient,
    private val vix: VixcloudClient,
    private val animeClient: AnimeUnityClient,
    private val repository: AppRepository,
    private val warpTunnel: WarpTunnel,
    private val settings: SettingsDataStore
) {
    private val titleCache = mutableMapOf<String, ProviderResolveTitleOutcome>()

    private fun cacheKey(id: Int, type: String, useProxy: Boolean) =
        "$type:$id:${if (useProxy) "proxy" else "local"}"

    // Proxy-on and proxy-off resolve into separate cache entries: a WARP resolve
    // must not be reused when WARP is off (and vice-versa). prime/invalidate touch
    // both so a confirmed mapping is reused regardless of the current mode.
    private fun cacheKeysForAllModes(id: Int, type: String) =
        listOf(cacheKey(id, type, false), cacheKey(id, type, true))

    /**
     * Point the provider/vixcloud clients at the WARP-proxied client when the
     * toggle is on and the tunnel comes up; otherwise fall back to direct.
     * Returns the *effective* proxy state so callers pick the matching cache key
     * and playback path. Android port of iOS `ProviderResolver.prepareWARP`.
     */
    private suspend fun prepareWARP(): Boolean {
        val enabled = settings.warpEnabled.first()
        if (!enabled || !warpTunnel.isAvailable) {
            provider.resetClient()
            vix.resetClient()
            animeClient.resetClient()
            return false
        }
        val proxied = if (warpTunnel.start()) warpTunnel.proxiedClient() else null
        if (proxied == null) {
            ProviderDebugLogger.log("ProviderResolver.prepareWARP: tunnel not ready → direct")
            provider.resetClient()
            vix.resetClient()
            animeClient.resetClient()
            return false
        }
        provider.setClient(proxied)
        vix.setClient(proxied)
        animeClient.setClient(proxied)
        ProviderDebugLogger.log("ProviderResolver.prepareWARP: routing through WARP proxy")
        return true
    }

    /** Seed the in-memory cache from a persisted mapping so a confirmed title
     * is reused without re-searching. */
    fun prime(tmdbId: Int, mediaType: String, outcome: ProviderResolveTitleOutcome) {
        for (key in cacheKeysForAllModes(tmdbId, mediaType)) titleCache[key] = outcome
    }

    /** Drop the cached title outcome (forces the next resolve to re-search). */
    fun invalidate(tmdbId: Int, mediaType: String) {
        for (key in cacheKeysForAllModes(tmdbId, mediaType)) titleCache.remove(key)
    }

    /** Resolve (or reuse cached) the provider title for a TMDB id. */
    suspend fun resolveTitle(
        tmdbId: Int,
        mediaType: String,
        title: String,
        releaseDate: String?,
        forceRefresh: Boolean = false
    ): ProviderResolveTitleOutcome {
        val useProxy = prepareWARP()
        return resolveTitleInternal(tmdbId, mediaType, title, releaseDate, forceRefresh, useProxy)
    }

    /** Resolve once the WARP session/mode is already prepared. */
    private suspend fun resolveTitleInternal(
        tmdbId: Int,
        mediaType: String,
        title: String,
        releaseDate: String?,
        forceRefresh: Boolean,
        useProxy: Boolean
    ): ProviderResolveTitleOutcome {
        ProviderDebugLogger.log("ProviderResolver.resolveTitle: tmdbId=$tmdbId mediaType=$mediaType forceRefresh=$forceRefresh useProxy=$useProxy")
        val key = cacheKey(tmdbId, mediaType, useProxy)
        if (!forceRefresh) {
            titleCache[key]?.let {
                ProviderDebugLogger.log("ProviderResolver.resolveTitle: returning cached outcome resolved=${it.resolved != null}")
                return it
            }
        }
        val outcome = provider.resolveTitle(tmdbId, mediaType, title, releaseDate)
        ProviderDebugLogger.log("ProviderResolver.resolveTitle: outcome resolved=${outcome.resolved != null} reason=${outcome.reason} candidates=${outcome.candidates.size}")
        titleCache[key] = outcome
        return outcome
    }

    /** Manually pin a candidate as the resolved title (provider picker). */
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

    // region Playable source

    suspend fun movieSource(tmdbId: Int, title: String, releaseDate: String?): PlaybackResolution {
        ProviderDebugLogger.log("ProviderResolver.movieSource: tmdbId=$tmdbId title='$title'")
        val useProxy = prepareWARP()
        val outcome = resolveTitleInternal(tmdbId, "movie", title, releaseDate, forceRefresh = false, useProxy = useProxy)
        val resolved = outcome.resolved
            ?: return PlaybackResolution(
                sources = emptyList(),
                reason = outcome.reason ?: ProviderResolveFailureReason.NOT_FOUND,
                message = unavailableMessage(outcome.reason),
                providerTitle = null,
                candidates = outcome.candidates,
                viaProxy = useProxy
            ).also {
                ProviderDebugLogger.log("ProviderResolver.movieSource: no resolved title (reason=${outcome.reason})")
            }
        val embed = provider.movieEmbed(resolved.id)
        return finalize(embed, resolved, outcome.candidates, useProxy)
    }

    suspend fun episodeSource(
        tmdbId: Int,
        title: String,
        releaseDate: String?,
        season: Int,
        episode: Int
    ): PlaybackResolution {
        ProviderDebugLogger.log("ProviderResolver.episodeSource: tmdbId=$tmdbId title='$title' S${season}E$episode")
        val useProxy = prepareWARP()
        val outcome = resolveTitleInternal(tmdbId, "tv", title, releaseDate, forceRefresh = false, useProxy = useProxy)
        val resolved = outcome.resolved
            ?: return PlaybackResolution(
                sources = emptyList(),
                reason = outcome.reason ?: ProviderResolveFailureReason.NOT_FOUND,
                message = unavailableMessage(outcome.reason),
                providerTitle = null,
                candidates = outcome.candidates,
                viaProxy = useProxy
            ).also {
                ProviderDebugLogger.log("ProviderResolver.episodeSource: no resolved title (reason=${outcome.reason})")
            }
        val embed = provider.episodeEmbed(resolved.id, resolved.slug, season, episode)
        return finalize(embed, resolved, outcome.candidates, useProxy)
    }

    /**
     * Resolve an AnimeUnity episode to playable HLS sources. Anime has its own
     * native catalog (no TMDB title search): go straight from the AnimeUnity
     * episode id to a vixcloud embed URL, then reuse [VixcloudClient] exactly
     * like the TMDB path. Port of iOS `ProviderResolver.animeSource`.
     */
    suspend fun animeSource(animeId: Int, slug: String?, episodeId: Int): PlaybackResolution {
        ProviderDebugLogger.log("ProviderResolver.animeSource: animeId=$animeId slug=$slug episodeId=$episodeId")
        val useProxy = prepareWARP()
        return try {
            val embedUrl = animeClient.embedURL(episodeId = episodeId, animeId = animeId, slug = slug)
            val sources = vix.playbackSources(embedUrl)
            ProviderDebugLogger.log("ProviderResolver.animeSource: got ${sources.size} playable sources")
            PlaybackResolution(
                sources = sources,
                reason = null,
                message = null,
                providerTitle = null,
                candidates = emptyList(),
                viaProxy = useProxy
            )
        } catch (e: Exception) {
            ProviderDebugLogger.logError("ProviderResolver.animeSource: failed", e)
            PlaybackResolution(
                sources = emptyList(),
                reason = ProviderResolveFailureReason.TEMPORARILY_UNAVAILABLE,
                message = e.message ?: "Riproduzione non disponibile.",
                providerTitle = null,
                candidates = emptyList(),
                viaProxy = useProxy
            )
        }
    }

    private suspend fun finalize(
        embed: ProviderEmbedOutcome,
        resolved: ProviderResolvedTitle,
        candidates: List<ProviderCandidate>,
        useProxy: Boolean
    ): PlaybackResolution {
        ProviderDebugLogger.log("ProviderResolver.finalize: embedUrl=${embed.embedUrl != null} reason=${embed.reason}")
        val embedUrl = embed.embedUrl
            ?: return PlaybackResolution(
                sources = emptyList(),
                reason = embed.reason ?: ProviderResolveFailureReason.NOT_FOUND,
                message = unavailableMessage(embed.reason),
                providerTitle = resolved,
                candidates = candidates,
                viaProxy = useProxy
            ).also {
                ProviderDebugLogger.log("ProviderResolver.finalize: no embed URL")
            }
        return try {
            val sources = vix.playbackSources(embedUrl)
            ProviderDebugLogger.log("ProviderResolver.finalize: got ${sources.size} playable sources")
            PlaybackResolution(
                sources = sources,
                reason = null,
                message = null,
                providerTitle = resolved,
                candidates = candidates,
                viaProxy = useProxy
            )
        } catch (e: Exception) {
            ProviderDebugLogger.logError("ProviderResolver.finalize: vix.playbackSources failed", e)
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

    // endregion

    // region Persistence helpers

    /** Save a resolved mapping to Room for future reuse. */
    suspend fun saveMapping(tmdbId: Int, mediaType: String, outcome: ProviderResolveTitleOutcome) {
        val resolved = outcome.resolved ?: return
        repository.saveProviderMapping(
            ProviderMappingEntity(
                tmdbId = tmdbId,
                scId = resolved.id,
                scSlug = resolved.slug ?: "",
                scType = mediaType,
                scBaseUrl = ""
            )
        )
    }

    /** Load a persisted mapping and prime the in-memory cache. */
    suspend fun loadAndPrime(tmdbId: Int, mediaType: String) {
        val entity = repository.getProviderMapping(tmdbId) ?: return
        val resolved = ProviderResolvedTitle(
            id = entity.scId,
            slug = entity.scSlug.takeIf { it.isNotEmpty() },
            title = "", // title not stored in entity, will be filled by resolve
            mediaType = entity.scType
        )
        prime(tmdbId, mediaType, ProviderResolveTitleOutcome(
            resolved = resolved,
            reason = null,
            candidates = emptyList(),
            matchStatus = ProviderMatchStatus.MANUAL_CONFIRMED
        ))
    }

    // endregion
}