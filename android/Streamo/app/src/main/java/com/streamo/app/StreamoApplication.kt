package com.streamo.app

import android.app.Application
import android.util.Log
import com.streamo.app.download.DownloadInfrastructure
import com.streamo.app.download.DownloadStateSyncer
import com.streamo.app.download.StreamoDownloadService
import androidx.media3.exoplayer.offline.DownloadService
import androidx.media3.common.util.UnstableApi
import com.streamo.app.player.streamo.StreamoCastService
import com.streamo.app.util.isTvDevice
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

private const val TAG = "StreamoDownload"

@UnstableApi
@HiltAndroidApp
class StreamoApplication : Application() {

    @Inject lateinit var downloadStateSyncer: DownloadStateSyncer

    override fun onCreate() {
        super.onCreate()

        // Catch uncaught exceptions in any thread and log them before the process dies
        val defaultHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            Log.e("StreamoCrash", "Uncaught exception in thread ${thread.name}", throwable)
            defaultHandler?.uncaughtException(thread, throwable)
        }

        Log.d(TAG, "Application onCreate")
        DownloadInfrastructure.initialize(this)
        Log.d(TAG, "DownloadInfrastructure initialized")
        downloadStateSyncer.attach(DownloadInfrastructure.downloadManager)
        Log.d(TAG, "DownloadStateSyncer attached")

        // Remove any stale downloads left behind by the old DownloadService approach.
        // The new ResolveAndDownloadWorker handles downloading directly via HlsDownloader.
        try {
            val stale = DownloadInfrastructure.downloadManager.currentDownloads
            if (stale.isNotEmpty()) {
                Log.d(TAG, "Removing ${stale.size} stale download(s) from DownloadManager")
                stale.forEach { download ->
                    Log.d(TAG, "  removing stale: ${download.request.id} state=${download.state}")
                    DownloadInfrastructure.downloadManager.removeDownload(download.request.id)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to clean stale downloads", e)
        }

        // Keep the service for existing downloads and notifications, but new downloads
        // are driven directly by ResolveAndDownloadWorker using HlsDownloader.
        try {
            DownloadService.start(this, StreamoDownloadService::class.java)
            Log.d(TAG, "DownloadService.start called")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start DownloadService", e)
        }

        // Avvia il server cast Streamo-to-Streamo sui dispositivi TV.
        if (isTvDevice()) {
            StreamoCastService.startIfTv(this)
            Log.d(TAG, "StreamoCastService started (TV device)")
        }
    }
}
