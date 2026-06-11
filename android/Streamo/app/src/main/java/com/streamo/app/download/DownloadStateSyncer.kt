package com.streamo.app.download

import android.content.Context
import android.util.Log
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadManager
import com.streamo.app.data.repository.AppRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

private const val TAG = "MediaDownload"

@UnstableApi
@Singleton
class DownloadStateSyncer @Inject constructor(
    private val repository: AppRepository,
    @ApplicationContext private val context: Context
) {
    private val scope = CoroutineScope(Dispatchers.IO)

    /** Per-download last (bytes, timestampMs), used to derive download speed between events. */
    private val speedSamples = HashMap<String, Pair<Long, Long>>()

    fun attach(downloadManager: DownloadManager) {
        Log.d(TAG, "Attaching DownloadManager listener")
        downloadManager.addListener(object : DownloadManager.Listener {
            override fun onDownloadChanged(
                downloadManager: DownloadManager,
                download: Download,
                finalException: Exception?
            ) {
                val bytes = download.bytesDownloaded
                val excMsg = finalException?.let { " exc=${it.javaClass.simpleName}:${it.message?.take(60)}" } ?: ""
                Log.d(TAG, "onDownloadChanged: id=${download.request.id} state=${download.state} pct=${download.percentDownloaded} bytes=$bytes mime=${download.request.mimeType ?: "null"}$excMsg")
                scope.launch {
                    val entry = repository.getDownloadByContentId(download.request.id)
                    entry?.let {
                        val status = when (download.state) {
                            Download.STATE_QUEUED, Download.STATE_RESTARTING -> "pending"
                            Download.STATE_STOPPED -> "paused"
                            Download.STATE_DOWNLOADING -> "downloading"
                            Download.STATE_COMPLETED -> "completed"
                            Download.STATE_FAILED -> "failed"
                            else -> "pending"
                        }

                        val percentage = download.percentDownloaded.coerceAtLeast(0f)
                        val bytesDownloaded = download.bytesDownloaded
                        val bytesTotal = if (percentage > 0f) {
                            (bytesDownloaded / (percentage / 100f)).toLong()
                        } else 0L

                        val key = download.request.id
                        val nowMs = System.currentTimeMillis()
                        val speed = if (status == "downloading") {
                            val prev = speedSamples[key]
                            speedSamples[key] = bytesDownloaded to nowMs
                            if (prev != null) {
                                val deltaBytes = (bytesDownloaded - prev.first).coerceAtLeast(0L)
                                val deltaSec = (nowMs - prev.second) / 1000.0
                                if (deltaSec > 0) (deltaBytes / deltaSec).toLong() else 0L
                            } else 0L
                        } else {
                            speedSamples.remove(key)
                            0L
                        }

                        Log.d(TAG, "Updating Room: id=${it.id} status=$status pct=$percentage bytes=$bytesDownloaded speed=$speed")
                        repository.updateDownloadProgress(
                            it.id,
                            percentage,
                            bytesDownloaded,
                            bytesTotal,
                            speed,
                            status
                        )

                        if (download.state == Download.STATE_FAILED) {
                            Log.e(TAG, "Download failed for ${download.request.id}", finalException)
                            if (it.retryCount < ResolveAndDownloadWorker.MAX_RETRIES) {
                                scope.launch {
                                    repository.incrementRetryAndReset(it.id)
                                    Log.d(TAG, "Retrying download ${download.request.id} (attempt ${it.retryCount + 1})")
                                    // Remove failed download from ExoPlayer so we can re-add it fresh
                                    DownloadInfrastructure.downloadManager.removeDownload(download.request.id)
                                    delay(2000)
                                    // Re-enter the serial download queue.
                                    ResolveAndDownloadWorker.enqueue(context, it.id)
                                }
                            } else {
                                repository.markDownloadFailed(it.id, finalException?.localizedMessage)
                            }
                        }
                    } ?: Log.w(TAG, "No Room entry for contentId=${download.request.id}")
                }
            }

            override fun onDownloadRemoved(
                downloadManager: DownloadManager,
                download: Download
            ) {
                Log.d(TAG, "onDownloadRemoved: id=${download.request.id}")
            }

            override fun onIdle(downloadManager: DownloadManager) {
                Log.d(TAG, "DownloadManager idle")
            }
        })
    }
}
