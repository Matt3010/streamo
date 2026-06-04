package com.streamo.app.provider

import com.streamo.app.data.local.entity.ProviderMappingEntity
import com.streamo.app.data.repository.StreamoRepository
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
    private val repository: StreamoRepository
) {
    private val titleCache = mutableMapOf<String, ProviderResolveTitleOutcome>()

    private fun cacheKey(id: Int, type: String) = "$type:$id"

    /** Seed the in-memory cache from a persisted mapping so a confirmed title
     * is reused without re-searching. */
    fun prime(tmdbId: Int, mediaType: String, outcome: ProviderResolveTitleOutcome) {
        titleCache[cacheKey(tmdbId, mediaType)] = outcome
    }

    /** Drop the cached title outcome (forces the next resolve to re-search). */
    fun invalidate(tmdbId: Int, mediaType: String) {
        titleCache.remove(cacheKey(tmdbId, mediaType))
    }

    /** Resolve (or reuse cached) the provider title for a TMDB id. */
    suspend fun resolveTitle(
        tmdbId: Int,
        mediaType: String,
        title: String,
        releaseDate: String?,
        forceRefresh: Boolean = false
    ): ProviderResolveTitleOutcome {
        ProviderDebugLogger.log("ProviderResolver.resolveTitle: tmdbId=$tmdbId mediaType=$mediaType forceRefresh=$forceRefresh")
        val key = cacheKey(tmdbId, mediaType)
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
        val existing = titleCache[cacheKey(tmdbId, mediaType)]
        titleCache[cacheKey(tmdbId, mediaType)] = ProviderResolveTitleOutcome(
            resolved = resolved,
            reason = null,
            candidates = existing?.candidates ?: emptyList(),
            matchStatus = ProviderMatchStatus.MANUAL_CONFIRMED
        )
    }

    // region Playable source

    suspend fun movieSource(tmdbId: Int, title: String, releaseDate: String?): PlaybackResolution {
        ProviderDebugLogger.log("ProviderResolver.movieSource: tmdbId=$tmdbId title='$title'")
        val outcome = resolveTitle(tmdbId, "movie", title, releaseDate)
        val resolved = outcome.resolved
            ?: return PlaybackResolution(
                sources = emptyList(),
                reason = outcome.reason ?: ProviderResolveFailureReason.NOT_FOUND,
                message = unavailableMessage(outcome.reason),
                providerTitle = null,
                candidates = outcome.candidates
            ).also {
                ProviderDebugLogger.log("ProviderResolver.movieSource: no resolved title (reason=${outcome.reason})")
            }
        val embed = provider.movieEmbed(resolved.id)
        return finalize(embed, resolved, outcome.candidates)
    }

    suspend fun episodeSource(
        tmdbId: Int,
        title: String,
        releaseDate: String?,
        season: Int,
        episode: Int
    ): PlaybackResolution {
        ProviderDebugLogger.log("ProviderResolver.episodeSource: tmdbId=$tmdbId title='$title' S${season}E$episode")
        val outcome = resolveTitle(tmdbId, "tv", title, releaseDate)
        val resolved = outcome.resolved
            ?: return PlaybackResolution(
                sources = emptyList(),
                reason = outcome.reason ?: ProviderResolveFailureReason.NOT_FOUND,
                message = unavailableMessage(outcome.reason),
                providerTitle = null,
                candidates = outcome.candidates
            ).also {
                ProviderDebugLogger.log("ProviderResolver.episodeSource: no resolved title (reason=${outcome.reason})")
            }
        val embed = provider.episodeEmbed(resolved.id, resolved.slug, season, episode)
        return finalize(embed, resolved, outcome.candidates)
    }

    private suspend fun finalize(
        embed: ProviderEmbedOutcome,
        resolved: ProviderResolvedTitle,
        candidates: List<ProviderCandidate>
    ): PlaybackResolution {
        ProviderDebugLogger.log("ProviderResolver.finalize: embedUrl=${embed.embedUrl != null} reason=${embed.reason}")
        val embedUrl = embed.embedUrl
            ?: return PlaybackResolution(
                sources = emptyList(),
                reason = embed.reason ?: ProviderResolveFailureReason.NOT_FOUND,
                message = unavailableMessage(embed.reason),
                providerTitle = resolved,
                candidates = candidates
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
                candidates = candidates
            )
        } catch (e: Exception) {
            ProviderDebugLogger.logError("ProviderResolver.finalize: vix.playbackSources failed", e)
            PlaybackResolution(
                sources = emptyList(),
                reason = ProviderResolveFailureReason.TEMPORARILY_UNAVAILABLE,
                message = e.message ?: "Riproduzione non disponibile.",
                providerTitle = resolved,
                candidates = candidates
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