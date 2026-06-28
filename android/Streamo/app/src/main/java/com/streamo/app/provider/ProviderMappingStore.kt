package com.streamo.app.provider

import com.streamo.app.data.local.entity.ProviderMappingEntity
import com.streamo.app.data.repository.AppRepository
import com.streamo.provider.sdk.ProviderMatchStatus
import com.streamo.provider.sdk.ProviderResolveTitleOutcome
import com.streamo.provider.sdk.ProviderResolvedTitle
import com.streamo.provider.sdk.StreamProvider
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Host-side persistence of confirmed TMDB→provider title mappings (Room).
 *
 * This is intentionally NOT part of the [StreamProvider] contract: an extension
 * must never see the host's database. The store reads/writes Room and primes the
 * active provider's in-session cache, keeping the SDK surface clean for the
 * eventual separate-APK split.
 */
@Singleton
class ProviderMappingStore @Inject constructor(
    private val repository: AppRepository
) {
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

    /** Load a persisted mapping and prime the given provider's in-memory cache. */
    suspend fun loadAndPrime(provider: StreamProvider, tmdbId: Int, mediaType: String) {
        val entity = repository.getProviderMapping(tmdbId) ?: return
        val resolved = ProviderResolvedTitle(
            id = entity.scId,
            slug = entity.scSlug.takeIf { it.isNotEmpty() },
            title = "", // title not stored in entity, will be filled by resolve
            mediaType = entity.scType
        )
        provider.prime(
            tmdbId, mediaType,
            ProviderResolveTitleOutcome(
                resolved = resolved,
                reason = null,
                candidates = emptyList(),
                matchStatus = ProviderMatchStatus.MANUAL_CONFIRMED
            )
        )
    }
}
