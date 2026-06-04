package com.streamo.app.download

import java.util.concurrent.atomic.AtomicBoolean

/**
 * Global pause gate for worker-based downloads ([ResolveAndDownloadWorker]).
 *
 * Worker downloads run via HlsDownloader directly, NOT through media3's DownloadManager,
 * so DownloadManager.pauseDownloads() has no effect on them. This flag is the actual
 * brake: while online streaming is active it is set, the running worker bails out of its
 * download loop (keeping cached segments), and any worker that starts meanwhile pauses
 * immediately instead of downloading. Offline playback does NOT set it — watching a
 * downloaded title leaves the queue running.
 */
object DownloadGate {
    val streamingActive = AtomicBoolean(false)
}
