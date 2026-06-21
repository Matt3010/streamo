package com.streamo.app.download

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.StreamKey
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.hls.offline.HlsDownloader
import androidx.media3.exoplayer.offline.DownloadHelper
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.work.BackoffPolicy
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.streamo.app.MainActivity
import com.streamo.app.data.preferences.SettingsDataStore
import com.streamo.app.data.repository.AppRepository
import com.streamo.app.provider.ProviderResolver
import com.streamo.app.provider.VixcloudClient
import com.streamo.app.provider.warp.WarpTunnel
import com.streamo.app.tmdb.TMDBImage
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume
import okhttp3.OkHttpClient

private const val TAG = "MediaDownload"
private const val PROGRESS_INTERVAL_MS = 800L

@UnstableApi
class ResolveAndDownloadWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    @EntryPoint
    @InstallIn(SingletonComponent::class)
    interface WorkerEntryPoint {
        fun providerResolver(): ProviderResolver
        fun repository(): AppRepository
        fun warpTunnel(): WarpTunnel
        fun settings(): SettingsDataStore
    }

    private fun entryPoint(): WorkerEntryPoint =
        EntryPointAccessors.fromApplication(applicationContext, WorkerEntryPoint::class.java)

    override suspend fun doWork(): Result {
        val downloadId = inputData.getInt(KEY_DOWNLOAD_ID, -1)
        Log.d(TAG, "Worker started for downloadId=$downloadId attempt=$runAttemptCount")
        if (downloadId == -1) {
            Log.e(TAG, "Invalid downloadId")
            return Result.failure()
        }

        val repository = entryPoint().repository()
        val resolver = entryPoint().providerResolver()
        val warpTunnel = entryPoint().warpTunnel()
        val settings = entryPoint().settings()

        val entry = repository.getDownloadById(downloadId) ?: return Result.failure().also {
            Log.e(TAG, "DownloadEntry not found for id=$downloadId")
        }
        Log.d(TAG, "Entry found: ${entry.title}, status=${entry.status}, retries=${entry.retryCount}")

        if (entry.retryCount >= MAX_RETRIES) {
            Log.e(TAG, "Max retries reached for downloadId=$downloadId")
            repository.markDownloadFailed(downloadId, "Numero massimo di tentativi raggiunto")
            return Result.failure()
        }

        // Online streaming in progress → don't compete for bandwidth. Pause and let the
        // player re-enqueue us when it closes. No retry: retryCount stays intact.
        if (DownloadGate.streamingActive.get()) {
            Log.d(TAG, "Streaming active, pausing downloadId=$downloadId")
            repository.updateDownloadStatus(downloadId, "paused")
            return Result.failure()
        }

        repository.updateDownloadStatus(downloadId, "resolving")
        Log.d(TAG, "Status set to resolving")

        val itemTitle = if (entry.mediaType == "tv" && entry.season > 0) {
            "${entry.title} · S${entry.season}E${entry.episode}"
        } else {
            entry.title
        }
        // Load poster bitmap once for the notification large icon.
        val posterBitmap = loadPosterBitmap(entry.posterPath)
        // Persistent foreground notification for the active download.
        try {
            setForeground(foregroundInfo(buildNotification(itemTitle, "In preparazione…", 0, true, posterBitmap)))
        } catch (e: Exception) {
            Log.w(TAG, "setForeground failed", e)
        }

        // Legge una volta il warp attuale, serve sia per il tunnel che per decidere
        // se riusare lo streamUrl salvato (stesso warp → stesso token vixcloud).
        val warpEnabled = settings.warpEnabled.first()

        // Build upstream DataSource.Factory with vixcloud headers (Referer, Origin).
        // When WARP is enabled, start the tunnel and route through its proxied client
        // so the IP matches what vixcloud saw during resolution (token IP-binding).
        val proxiedClient = if (warpEnabled && warpTunnel.isAvailable) {
            if (warpTunnel.start()) warpTunnel.proxiedClient() else null
        } else null

        // Always use the same vixcloud-friendly headers regardless of WARP state.
        // A dedicated OkHttpClient with fresh connection pool avoids stale connections
        // and the Accept: */* header that vixcloud rejects for HLS endpoints.
        val baseClient = proxiedClient ?: OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()

        val upstreamFactory: DataSource.Factory = OkHttpDataSource.Factory(baseClient)
            .setDefaultRequestProperties(VixcloudClient.playbackHeaders)
            .setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

        // Wrap in CacheDataSource so cached segments serve from disk.
        val proxiedCacheFactory = CacheDataSource.Factory()
            .setCache(DownloadInfrastructure.cache)
            .setUpstreamDataSourceFactory(upstreamFactory)
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)

        try {
            val contentId = "${entry.tmdbId}_${entry.mediaType}_${entry.season}_${entry.episode}"

            // Se abbiamo giá uno streamUrl salvato E il warp non é cambiato,
            // riusa l'URL esistente. Cosí i segmenti giá in cache sotto la stessa
            // cache key vengono ripresi invece di ricominciare da zero.
            // Solo quando il warp cambia (o non c'é URL salvato) rifacciamo la
            // risoluzione dal provider, perché vixcloud lega il token all'IP.
            val streamUrl = if (entry.streamUrl.isNotBlank() && entry.warpEnabled == warpEnabled) {
                Log.d(TAG, "Reusing existing streamUrl (warp unchanged), contentId=${entry.contentId}")
                entry.streamUrl
            } else {
                val resolution = if (entry.mediaType == "tv" && entry.season > 0) {
                    resolver.episodeSource(entry.tmdbId, entry.title, null, entry.season, entry.episode.coerceAtLeast(1))
                } else {
                    resolver.movieSource(entry.tmdbId, entry.title, null)
                }
                Log.d(TAG, "Resolver returned ${resolution.sources.size} source(s). Message=${resolution.message}")

                if (resolution.sources.isEmpty()) {
                    throw IllegalStateException(resolution.message ?: "Nessuno stream disponibile")
                }
                resolution.sources.first().playlistUrl
            }
            Log.d(TAG, "streamUrl=$streamUrl, contentId=$contentId")

            // Persist the WARP state this streamUrl was resolved under, so the
            // reuse check above and pickNextPendingDownload prioritization stay
            // accurate when the entry was picked under a different WARP than saved.
            repository.updateDownloadContentStatusAndWarp(downloadId, contentId, streamUrl, "downloading", warpEnabled)
            Log.d(TAG, "Room updated to downloading")

            // Resolve stream keys for a SINGLE video rendition (+ default audio).
            // Without keys, HlsDownloader fetches every quality and every audio
            // rendition, bloating the download 3-5x. Il tetto altezza (se impostato)
            // arriva da entry.quality: scarica la variante ≤ tetto più alta.
            val maxHeight = DownloadQualityPref.capHeightFromEntryQuality(entry.quality)
            val (streamKeys, chosenHeight) = resolveStreamKeys(streamUrl, maxHeight, upstreamFactory)
            Log.d(TAG, "Resolved ${streamKeys.size} streamKey(s) for $contentId, height=$chosenHeight")
            // Registra la risoluzione effettivamente scaricata (es. "1080p") al posto della
            // label di preferenza ("Massima"), così l'item completato mostra la qualità vera.
            if (chosenHeight != null) {
                repository.updateDownloadQuality(downloadId, "${chosenHeight}p")
            }

            // Direct HLS download — bypass DownloadService entirely.
            // HlsDownloader fetches the master playlist, the selected variant
            // playlists, and their segments, writing them into the SimpleCache.
            val mediaItem = MediaItem.Builder()
                .setUri(streamUrl)
                .setMimeType(MimeTypes.APPLICATION_M3U8)
                .setStreamKeys(streamKeys)
                .build()

            // 12 parallel threads: matches iOS (maxConcurrentSegmentDownloads = 12),
            // which sustains this segment concurrency on the same provider without
            // bans. If HTTP 429 / IP bans appear, lower this.
            val downloader = HlsDownloader(
                mediaItem,
                proxiedCacheFactory,
                Executors.newFixedThreadPool(12)
            )

            var lastUpdateTime = 0L
            var lastBytes = 0L
            val updatePending = AtomicBoolean(false)
            val workerScope = CoroutineScope(coroutineContext + SupervisorJob())

            Log.d(TAG, "Starting HlsDownloader for $contentId")
            downloader.download { contentLength, bytesDownloaded, percent ->
                // User pressed Stop, or online streaming started → bail out of the
                // blocking download promptly. Cached segments stay on disk so the
                // download can resume later.
                if (isStopped) throw InterruptedException("Download stopped by user")
                if (DownloadGate.streamingActive.get()) throw InterruptedException("Paused for streaming")
                val now = System.currentTimeMillis()
                if (now - lastUpdateTime > PROGRESS_INTERVAL_MS) {
                    // Download speed = bytes gained since last write / elapsed time.
                    // First tick (lastUpdateTime == 0) has no baseline → report 0.
                    val speed = if (lastUpdateTime > 0L) {
                        val deltaBytes = (bytesDownloaded - lastBytes).coerceAtLeast(0L)
                        val deltaSec = (now - lastUpdateTime) / 1000.0
                        if (deltaSec > 0) (deltaBytes / deltaSec).toLong() else 0L
                    } else 0L

                    lastUpdateTime = now
                    lastBytes = bytesDownloaded

                    val pct = if (percent >= 0f) percent else 0f
                    val bytesTotal = if (pct > 0f && contentLength > 0) {
                        contentLength
                    } else 0L

                    Log.d(TAG, "Progress: id=$downloadId pct=${"%.1f".format(pct)} bytes=$bytesDownloaded total=$bytesTotal speed=$speed")

                    // Update the persistent notification.
                    if (!isStopped) {
                        val speedTxt = if (speed > 0) " · %.1f MB/s".format(speed / 1_048_576.0) else ""
                        updateNotification(
                            buildNotification(itemTitle, "${pct.toInt()}%$speedTxt", pct.toInt(), pct <= 0f, posterBitmap)
                        )
                    }

                    // De-bounce Room writes so the downloader thread never blocks on DB I/O.
                    if (updatePending.compareAndSet(false, true)) {
                        workerScope.launch {
                            try {
                                // Re-check: a Stop may have landed after the debounce was
                                // scheduled. Don't clobber the "paused" status set by stop().
                                if (isStopped) return@launch
                                repository.updateDownloadProgress(
                                    downloadId,
                                    pct,
                                    bytesDownloaded,
                                    bytesTotal,
                                    speed,
                                    "downloading"
                                )
                            } finally {
                                updatePending.set(false)
                            }
                        }
                    }
                }
            }

            Log.d(TAG, "Download completed: id=$downloadId contentId=$contentId")
            repository.updateDownloadProgress(
                downloadId,
                100f,
                lastBytes,
                lastBytes,
                0L,
                "completed"
            )
            return Result.success()
        } catch (e: Exception) {
            // Stopped by the user (cancelWorkByTag) → leave DB status as set by stop(), no retry.
            if (isStopped) {
                Log.d(TAG, "Worker stopped (cancelled) for id=$downloadId")
                return Result.failure()
            }
            // Paused because streaming started mid-download → keep cache, mark paused,
            // no retry. The player re-enqueues on close.
            if (DownloadGate.streamingActive.get()) {
                Log.d(TAG, "Worker paused for streaming, id=$downloadId")
                repository.updateDownloadStatus(downloadId, "paused")
                return Result.failure()
            }
            Log.e(TAG, "Worker failed (attempt $runAttemptCount)", e)
            if (entry.retryCount < MAX_RETRIES) {
                repository.incrementRetryAndReset(downloadId)
                Log.d(TAG, "Scheduling retry for downloadId=$downloadId (retryCount=${entry.retryCount + 1})")
                return Result.retry()
            }
            repository.markDownloadFailed(downloadId, e.localizedMessage)
            return Result.failure()
        }
    }

    /**
     * Prepares the HLS manifest online and returns the stream keys for a single
     * video rendition plus the default audio/text tracks, so the downloader grabs
     * one quality instead of every variant. Empty list on failure → caller falls
     * back to downloading all renditions rather than failing outright.
     */
    private suspend fun resolveStreamKeys(
        streamUrl: String,
        maxHeight: Int?,
        upstreamFactory: DataSource.Factory
    ): Pair<List<StreamKey>, Int?> =
        suspendCancellableCoroutine { continuation ->
            val mediaItem = MediaItem.Builder()
                .setUri(streamUrl)
                .setMimeType(MimeTypes.APPLICATION_M3U8)
                .build()
            val downloadHelper = DownloadHelper.forMediaItem(
                applicationContext,
                mediaItem,
                DefaultRenderersFactory(applicationContext),
                upstreamFactory
            )

            downloadHelper.prepare(object : DownloadHelper.Callback {
                override fun onPrepared(helper: DownloadHelper) {
                    try {
                        // Altezze video disponibili nel master playlist.
                        val heights = mutableListOf<Int>()
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
                        // Altezza scelta: tetto → la più alta ≤ tetto (o la più bassa se
                        // nessuna rientra); nessun tetto → la più alta disponibile.
                        val chosenHeight = when {
                            heights.isEmpty() -> null
                            maxHeight == null -> heights.max()
                            else -> heights.filter { it <= maxHeight }.maxOrNull() ?: heights.min()
                        }
                        val params = if (chosenHeight != null) {
                            DefaultTrackSelector.Parameters.Builder(applicationContext)
                                .setMaxVideoSize(Int.MAX_VALUE, chosenHeight)
                                .build()
                        } else {
                            DefaultTrackSelector.Parameters.DEFAULT_WITHOUT_CONTEXT
                        }
                        // Default selection picks one video rendition (best within
                        // constraints) + default audio/subtitle tracks.
                        for (periodIndex in 0 until helper.periodCount) {
                            helper.addTrackSelection(periodIndex, params)
                        }
                        val keys = helper.getDownloadRequest(byteArrayOf()).streamKeys
                        helper.release()
                        continuation.resume(keys to chosenHeight)
                    } catch (e: Exception) {
                        helper.release()
                        Log.w(TAG, "Stream key resolution failed, downloading all renditions", e)
                        continuation.resume(emptyList<StreamKey>() to null)
                    }
                }

                override fun onPrepareError(helper: DownloadHelper, e: IOException) {
                    helper.release()
                    Log.w(TAG, "DownloadHelper prepare failed, downloading all renditions", e)
                    continuation.resume(emptyList<StreamKey>() to null)
                }
            })

            continuation.invokeOnCancellation { downloadHelper.release() }
        }

    /**
     * Fetch poster Bitmap from TMDB to show as large icon in notification.
     * Runs on IO dispatcher. Returns null on any failure (network, decode, missing path).
     */
    private suspend fun loadPosterBitmap(posterPath: String?): Bitmap? {
        val url = TMDBImage.url(posterPath, TMDBImage.Size.W154) ?: return null
        return withContext(Dispatchers.IO) {
            try {
                val connection = java.net.URL(url).openConnection().apply {
                    connectTimeout = 3000
                    readTimeout = 3000
                    setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36")
                }
                val input = connection.getInputStream()
                BitmapFactory.decodeStream(input).also { input.close() }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to load poster bitmap for notification", e)
                null
            }
        }
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                ACTIVE_CHANNEL_ID,
                "Download in corso",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Stato dei download attivi"
                setShowBadge(false)
            }
            (applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(channel)
        }
    }

    private fun buildNotification(
        contentTitle: String,
        text: String,
        pct: Int,
        indeterminate: Boolean,
        largeIcon: Bitmap? = null
    ): Notification {
        ensureChannel()
        val pi = PendingIntent.getActivity(
            applicationContext, 0,
            Intent(applicationContext, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(applicationContext, ACTIVE_CHANNEL_ID)
            .setContentTitle(contentTitle)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setLargeIcon(largeIcon)
            .setContentIntent(pi)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setProgress(100, pct.coerceIn(0, 100), indeterminate)
            .build()
    }

    private fun foregroundInfo(notification: Notification): ForegroundInfo =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(ACTIVE_NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(ACTIVE_NOTIF_ID, notification)
        }

    private fun updateNotification(notification: Notification) {
        try {
            NotificationManagerCompat.from(applicationContext).notify(ACTIVE_NOTIF_ID, notification)
        } catch (_: SecurityException) {
            // POST_NOTIFICATIONS not granted — foreground service notice still shows.
        }
    }

    companion object {
        const val KEY_DOWNLOAD_ID = "download_entry_id"
        const val MAX_RETRIES = 3
        private const val ACTIVE_CHANNEL_ID = "streamo_active_download"
        private const val ACTIVE_NOTIF_ID = 2002

        /**
         * Unique name for all downloads: REPLACE enforces a single worker at a time.
         * [DownloadQueueManager] picks the next pending download and enqueues it when
         * the current one finishes, gets paused, or fails — no chain needed.
         */
        const val DOWNLOAD_QUEUE = "streamo_download_queue"

        /** Per-download tag so a single item can be cancelled without touching the chain. */
        fun tag(downloadId: Int) = "dl_$downloadId"

        fun enqueue(context: Context, downloadId: Int) {
            val request = OneTimeWorkRequestBuilder<ResolveAndDownloadWorker>()
                .setInputData(
                    Data.Builder().putInt(KEY_DOWNLOAD_ID, downloadId).build()
                )
                .addTag(tag(downloadId))
                .setBackoffCriteria(BackoffPolicy.LINEAR, 2000, TimeUnit.MILLISECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                DOWNLOAD_QUEUE,
                ExistingWorkPolicy.REPLACE,
                request
            )
        }

        fun cancel(context: Context, downloadId: Int) {
            WorkManager.getInstance(context).cancelAllWorkByTag(tag(downloadId))
        }

        /**
         * Delete cached partial/complete data for a download. Blocking file I/O — call
         * off the main thread. Used by the trash action (NOT by stop, which keeps data).
         */
        fun removeCachedData(streamUrl: String) {
            if (streamUrl.isBlank()) return
            try {
                val mediaItem = MediaItem.Builder()
                    .setUri(streamUrl)
                    .setMimeType(MimeTypes.APPLICATION_M3U8)
                    .build()
                HlsDownloader(mediaItem, DownloadInfrastructure.cacheDataSourceFactory).remove()
                Log.d(TAG, "Removed cached data for $streamUrl")
            } catch (e: Exception) {
                Log.w(TAG, "Failed to remove cached data for $streamUrl", e)
            }
        }
    }
}
