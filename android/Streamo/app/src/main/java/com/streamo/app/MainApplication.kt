package com.streamo.app

import android.app.Application
import android.util.Log
import coil.ImageLoader
import coil.ImageLoaderFactory
import com.streamo.app.download.DownloadInfrastructure
import com.streamo.app.download.DownloadStateSyncer
import com.streamo.app.download.MediaDownloadService
import androidx.media3.exoplayer.offline.DownloadService
import androidx.media3.common.util.UnstableApi
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailabilityLight
import com.streamo.app.player.lancast.LanCastService
import com.streamo.app.tmdb.TMDBClient
import com.streamo.app.util.isTvDevice
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import javax.inject.Inject

private const val TAG = "MediaDownload"

@UnstableApi
@HiltAndroidApp
class MainApplication : Application(), ImageLoaderFactory {

    @Inject lateinit var downloadStateSyncer: DownloadStateSyncer
    @Inject lateinit var imageLoader: ImageLoader
    @Inject lateinit var tmdbClient: TMDBClient

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun newImageLoader(): ImageLoader = imageLoader

    override fun onCreate() {
        super.onCreate()

        // Catch uncaught exceptions in any thread and log them before the process dies
        val defaultHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            Log.e("AppCrash", "Uncaught exception in thread ${thread.name}", throwable)
            defaultHandler?.uncaughtException(thread, throwable)
        }

        Log.d(TAG, "Application onCreate")
        DownloadInfrastructure.initialize(this)
        Log.d(TAG, "DownloadInfrastructure initialized")
        downloadStateSyncer.attach(DownloadInfrastructure.downloadManager)
        Log.d(TAG, "DownloadStateSyncer attached")

        // Best-effort: rimuove le righe TMDB scadute dalla cache offline.
        appScope.launch {
            runCatching { tmdbClient.purgeExpired() }
                .onFailure { Log.d(TAG, "TMDB cache purge failed: ${it.message}") }
        }

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
            DownloadService.start(this, MediaDownloadService::class.java)
            Log.d(TAG, "DownloadService.start called")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start DownloadService", e)
        }

        // Avvia il server cast Obsidian-to-Obsidian sui dispositivi TV.
        if (isTvDevice()) {
            LanCastService.startIfTv(this)
            Log.d(TAG, "LanCastService started (TV device)")
        }

        // Pre-inizializza il Cast SDK se Play Services è disponibile: così il SessionManager
        // e la discovery MediaRouter sono pronti quando l'utente apre la modale di cast.
        // Su dispositivi senza GMS (Fire TV / Android TV) è un no-op sicuro.
        if (GoogleApiAvailabilityLight.getInstance()
                .isGooglePlayServicesAvailable(this) == ConnectionResult.SUCCESS
        ) {
            runCatching { CastContext.getSharedInstance(this) }
        }
    }
}
