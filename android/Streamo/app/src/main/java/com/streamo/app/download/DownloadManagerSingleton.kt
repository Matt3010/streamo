package com.streamo.app.download

import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.offline.DownloadManager

@UnstableApi
object DownloadManagerSingleton {
    lateinit var instance: DownloadManager
        private set

    fun initialize(manager: DownloadManager) {
        instance = manager
    }

    fun isInitialized(): Boolean = ::instance.isInitialized
}