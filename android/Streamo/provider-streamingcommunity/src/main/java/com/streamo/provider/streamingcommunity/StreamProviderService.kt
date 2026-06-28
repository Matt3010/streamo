package com.streamo.provider.streamingcommunity

import android.app.Service
import android.content.Intent
import android.os.IBinder
import com.streamo.provider.sdk.IStreamProviderService
import com.streamo.provider.sdk.ProviderJson
import com.streamo.provider.sdk.ProviderMetadata
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * Bound service the catalog host binds to (action [com.streamo.provider.sdk.ProviderIpc.ACTION_BIND]).
 * Each AIDL method runs the StreamingCommunity resolution and returns the
 * provider-neutral result as JSON (see [ProviderJson]). Binder calls arrive on a
 * binder thread, so the suspend resolver work is bridged with [runBlocking].
 */
class StreamProviderService : Service() {

    private val baseClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .build()
    }

    private val resolver: ScResolver by lazy { ScResolver(baseClient) }

    private val metadata = ProviderMetadata(
        id = "streamingcommunity",
        name = "StreamingCommunity",
        version = "1.0"
    )

    private val binder = object : IStreamProviderService.Stub() {

        override fun metadata(): String = ProviderJson.encodeMetadata(metadata)

        override fun resolveTitle(
            tmdbId: Int, mediaType: String, title: String, releaseDate: String?,
            forceRefresh: Boolean, useProxy: Boolean, proxyPort: Int, locale: String
        ): String = runBlocking {
            ProviderJson.encodeOutcome(
                resolver.resolveTitle(tmdbId, mediaType, title, releaseDate, forceRefresh, useProxy, proxyPort, locale)
            )
        }

        override fun movieSource(
            tmdbId: Int, title: String, releaseDate: String?,
            useProxy: Boolean, proxyPort: Int, locale: String
        ): String = runBlocking {
            ProviderJson.encodeResolution(
                resolver.movieSource(tmdbId, title, releaseDate, useProxy, proxyPort, locale)
            )
        }

        override fun episodeSource(
            tmdbId: Int, title: String, releaseDate: String?, season: Int, episode: Int,
            useProxy: Boolean, proxyPort: Int, locale: String
        ): String = runBlocking {
            ProviderJson.encodeResolution(
                resolver.episodeSource(tmdbId, title, releaseDate, season, episode, useProxy, proxyPort, locale)
            )
        }

        override fun confirmCandidate(candidateJson: String, tmdbId: Int, mediaType: String) {
            resolver.confirmCandidate(ProviderJson.decodeCandidate(candidateJson), tmdbId, mediaType)
        }

        override fun prime(tmdbId: Int, mediaType: String, outcomeJson: String) {
            resolver.prime(tmdbId, mediaType, ProviderJson.decodeOutcome(outcomeJson))
        }

        override fun invalidate(tmdbId: Int, mediaType: String) {
            resolver.invalidate(tmdbId, mediaType)
        }

        override fun debugLogs(): String = ProviderDebugLogger.getLogs()
    }

    override fun onBind(intent: Intent?): IBinder = binder
}
