package com.streamo.app.download

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadService
import com.streamo.app.MainActivity
import com.streamo.app.R

private const val TAG = "MediaDownload"

@UnstableApi
class MediaDownloadService : DownloadService(
    FOREGROUND_NOTIFICATION_ID,
    DEFAULT_FOREGROUND_NOTIFICATION_UPDATE_INTERVAL,
    CHANNEL_ID,
    R.string.download_notification_channel_name,
    R.string.download_notification_channel_description
) {

    override fun onCreate() {
        // DownloadInfrastructure is initialized in MainApplication.onCreate() before
        // DownloadService.start(), so getDownloadManager() can safely read it here.
        super.onCreate()
    }

    override fun getDownloadManager(): DownloadManager {
        Log.d(TAG, "MediaDownloadService getDownloadManager")
        return try {
            DownloadInfrastructure.downloadManager
        } catch (e: Exception) {
            Log.e(TAG, "getDownloadManager failed", e)
            throw e
        }
    }

    override fun getScheduler(): androidx.media3.exoplayer.scheduler.Scheduler? = null

    override fun getForegroundNotification(
        downloads: MutableList<Download>,
        notMetRequirements: Int
    ): Notification {
        val context = applicationContext
        ensureNotificationChannel(context)

        val totalDownloads = downloads.size
        val downloadingCount = downloads.count { it.state == Download.STATE_DOWNLOADING }
        val completedCount = downloads.count { it.state == Download.STATE_COMPLETED }
        val failedCount = downloads.count { it.state == Download.STATE_FAILED }

        Log.d(TAG, "getForegroundNotification: total=$totalDownloads downloading=$downloadingCount completed=$completedCount failed=$failedCount")

        val contentText = when {
            failedCount > 0 -> "Errore su $failedCount download"
            downloadingCount > 0 -> "$downloadingCount in corso · $completedCount completati"
            totalDownloads > 0 -> "Tutti i download completati"
            else -> "Download in corso..."
        }

        val contentIntent = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("Download")
            .setContentText(contentText)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setProgress(0, 0, downloadingCount > 0)

        builder.addAction(
            android.R.drawable.ic_menu_close_clear_cancel,
            "Apri",
            contentIntent
        )

        return builder.build()
    }

    companion object {
        private const val CHANNEL_ID = "streamo_download_channel"
        private const val FOREGROUND_NOTIFICATION_ID = 2001

        fun ensureNotificationChannel(context: Context) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    "Download",
                    NotificationManager.IMPORTANCE_LOW
                ).apply {
                    description = context.getString(R.string.download_notification_channel_description)
                    setShowBadge(false)
                }
                val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                notificationManager.createNotificationChannel(channel)
            }
        }
    }
}
