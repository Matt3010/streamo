package com.streamo.app.download

import android.content.Context
import android.util.Log
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.offline.DownloadHelper
import com.streamo.app.provider.ProviderManager
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

/**
 * Rileva le risoluzioni (altezze video) realmente disponibili per un titolo, risolvendo
 * la sorgente col provider attivo ([ProviderManager]) e leggendo le varianti del master playlist HLS via
 * ExoPlayer DownloadHelper. Restituisce le altezze distinte in ordine decrescente, anche
 * non standard. Lista vuota se la risoluzione fallisce (il chiamante decide il fallback).
 */
@UnstableApi
@Singleton
class DownloadResolutionProbe @Inject constructor(
    @ApplicationContext private val context: Context,
    private val providerManager: ProviderManager
) {
    private val TAG = "DownloadResProbe"

    suspend fun availableHeights(
        tmdbId: Int,
        mediaType: String,
        title: String,
        season: Int,
        episode: Int
    ): List<Int> {
        val provider = providerManager.active ?: return emptyList()
        val resolution = if (mediaType == "tv" && season > 0) {
            provider.episodeSource(tmdbId, title, null, season, episode.coerceAtLeast(1))
        } else {
            provider.movieSource(tmdbId, title, null)
        }
        val streamUrl = resolution.sources.firstOrNull()?.playlistUrl ?: return emptyList()
        return heightsFromManifest(streamUrl)
    }

    private suspend fun heightsFromManifest(streamUrl: String): List<Int> =
        suspendCancellableCoroutine { continuation ->
            val mediaItem = MediaItem.Builder()
                .setUri(streamUrl)
                .setMimeType(MimeTypes.APPLICATION_M3U8)
                .build()
            val helper = DownloadHelper.forMediaItem(
                context,
                mediaItem,
                DefaultRenderersFactory(context),
                DownloadInfrastructure.httpDataSourceFactory
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
