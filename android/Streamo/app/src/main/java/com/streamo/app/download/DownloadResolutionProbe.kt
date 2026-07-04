package com.streamo.app.download

import android.content.Context
import android.util.Log
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.offline.DownloadHelper
import com.streamo.app.provider.ProviderResolver
import com.streamo.app.provider.VixcloudClient
import com.streamo.app.provider.warp.WarpTunnel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.OkHttpClient
import java.io.IOException
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

/**
 * Rileva le risoluzioni (altezze video) realmente disponibili per un titolo, risolvendo
 * la sorgente col [ProviderResolver] e leggendo le varianti del master playlist HLS via
 * ExoPlayer DownloadHelper. Restituisce le altezze distinte in ordine decrescente, anche
 * non standard. Lista vuota se la risoluzione fallisce (il chiamante decide il fallback).
 */
@UnstableApi
@Singleton
class DownloadResolutionProbe @Inject constructor(
    @ApplicationContext private val context: Context,
    private val resolver: ProviderResolver,
    private val warpTunnel: WarpTunnel
) {
    private val TAG = "DownloadResProbe"

    // Client dedicato, non quello condiviso di DownloadInfrastructure: quello imposta
    // "Accept: */*" che vixcloud rifiuta sugli endpoint HLS (vedi commento in
    // ResolveAndDownloadWorker.resolveStreamKeys), facendo fallire il probe in modo
    // silenzioso (heights vuoto → dialog mostra "Massima (—)").
    private val plainClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    private fun upstreamFactory(baseClient: OkHttpClient): DataSource.Factory =
        OkHttpDataSource.Factory(baseClient)
            .setDefaultRequestProperties(VixcloudClient.playbackHeaders)
            .setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

    suspend fun availableHeights(
        tmdbId: Int,
        mediaType: String,
        title: String,
        season: Int,
        episode: Int
    ): List<Int> {
        val resolution = if (mediaType == "tv" && season > 0) {
            resolver.episodeSource(tmdbId, title, null, season, episode.coerceAtLeast(1))
        } else {
            resolver.movieSource(tmdbId, title, null)
        }
        val streamUrl = resolution.sources.firstOrNull()?.playlistUrl ?: return emptyList()
        // Con WARP il token vixcloud è IP-bound: se la risoluzione è passata dal
        // tunnel, il fetch del manifest deve uscire dalla stessa IP o vixcloud
        // risponde 403 (vedi PlayerViewModel/ResolveAndDownloadWorker).
        val baseClient = if (resolution.viaProxy) {
            warpTunnel.proxiedClient() ?: plainClient
        } else {
            plainClient
        }
        return heightsFromManifest(streamUrl, upstreamFactory(baseClient))
    }

    private suspend fun heightsFromManifest(streamUrl: String, upstreamFactory: DataSource.Factory): List<Int> =
        suspendCancellableCoroutine { continuation ->
            val mediaItem = MediaItem.Builder()
                .setUri(streamUrl)
                .setMimeType(MimeTypes.APPLICATION_M3U8)
                .build()
            val helper = DownloadHelper.forMediaItem(
                context,
                mediaItem,
                DefaultRenderersFactory(context),
                upstreamFactory
            )
            helper.prepare(object : DownloadHelper.Callback {
                override fun onPrepared(helper: DownloadHelper) {
                    val heights = sortedSetOf<Int>(compareByDescending { it })
                    try {
                        for (periodIndex in 0 until helper.periodCount) {
                            val groups = helper.getTrackGroups(periodIndex)
                            for (g in 0 until groups.length) {
                                val group = groups.get(g)
                                for (t in 0 until group.length) {
                                    val h = group.getFormat(t).height
                                    if (h > 0) heights += h
                                }
                            }
                        }
                    } catch (e: Exception) {
                        Log.w(TAG, "Failed reading heights", e)
                    } finally {
                        helper.release()
                    }
                    continuation.resume(heights.toList())
                }

                override fun onPrepareError(helper: DownloadHelper, e: IOException) {
                    Log.w(TAG, "DownloadHelper prepare failed", e)
                    helper.release()
                    continuation.resume(emptyList())
                }
            })
            continuation.invokeOnCancellation { helper.release() }
        }
}
