package com.streamo.app.download

import android.content.Context
import androidx.work.WorkManager
import com.streamo.app.data.preferences.SettingsDataStore
import com.streamo.app.data.repository.AppRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Single source of truth for "start the next pending download".
 *
 * The queue is driven by callers (the download ViewModels, the WARP toggle)
 * rather than a WorkManager chain. Every entry point funnels through [advance],
 * which is:
 *  - serialized by a [Mutex] so concurrent observers (multiple live ViewModels)
 *    can't pick and enqueue the same item twice;
 *  - guarded by the real WorkManager state for the unique work, so it won't
 *    re-enqueue (REPLACE) a worker that is already ENQUEUED/RUNNING and cancel it
 *    mid-start. The DB status still reads "pending" in the brief window between
 *    enqueue and the worker flipping to "resolving", so the DB alone isn't enough
 *    to detect "a worker is starting" — WorkManager is authoritative.
 */
@Singleton
class DownloadQueueManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val repository: AppRepository,
    private val settings: SettingsDataStore,
) {
    private val mutex = Mutex()

    /** Start the next pending download if no worker is currently queued/running. Idempotent. */
    suspend fun advance() = mutex.withLock {
        if (isQueueBusy()) return@withLock
        val currentWarp = settings.warpEnabled.first()
        val next = repository.pickNextPendingDownload(currentWarp) ?: return@withLock
        repository.resetRetryCount(next.id)
        repository.updateDownloadStatusResetSpeed(next.id, "pending")
        ResolveAndDownloadWorker.enqueue(context, next.id)
    }

    /**
     * True while a download worker is ENQUEUED or RUNNING for the unique queue work.
     * WorkManager (not the DB status) is authoritative: the DB still reads "pending"
     * during the window between enqueue and the worker setting "resolving".
     */
    private suspend fun isQueueBusy(): Boolean = withContext(Dispatchers.IO) {
        WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork(ResolveAndDownloadWorker.DOWNLOAD_QUEUE)
            .get()
            .any { !it.state.isFinished }
    }
}
