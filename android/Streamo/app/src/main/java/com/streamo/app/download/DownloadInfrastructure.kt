package com.streamo.app.download

import android.content.Context
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.NoOpCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.offline.DownloadManager
import okhttp3.ConnectionPool
import okhttp3.OkHttpClient
import okhttp3.Protocol
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@UnstableApi
object DownloadInfrastructure {

    private var _cache: SimpleCache? = null
    private var _downloadManager: DownloadManager? = null
    private var _cacheDataSourceFactory: CacheDataSource.Factory? = null
    private var _httpDataSourceFactory: DataSource.Factory? = null

    val cache: SimpleCache
        get() = _cache ?: error("DownloadInfrastructure not initialized. Call initialize() first.")

    val downloadManager: DownloadManager
        get() = _downloadManager ?: error("DownloadInfrastructure not initialized. Call initialize() first.")

    val cacheDataSourceFactory: CacheDataSource.Factory
        get() = _cacheDataSourceFactory ?: error("DownloadInfrastructure not initialized. Call initialize() first.")

    val httpDataSourceFactory: DataSource.Factory
        get() = _httpDataSourceFactory ?: error("DownloadInfrastructure not initialized. Call initialize() first.")

    fun initialize(context: Context) {
        if (_cache != null) return

        // OkHttp with HTTP/2 multiplexing + generous connection pool.
        // 6 idle connections with 5-minute keep-alive let parallel download threads
        // reuse existing TCP sockets instead of opening new ones.
        val okHttpClient = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .protocols(listOf(Protocol.HTTP_2, Protocol.HTTP_1_1))
            .connectionPool(ConnectionPool(6, 5, TimeUnit.MINUTES))
            .build()

        // Vixcloud requires Referer and Origin headers for manifest + segment requests
        _httpDataSourceFactory = OkHttpDataSource.Factory(okHttpClient)
            .setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .setDefaultRequestProperties(mapOf(
                "Referer" to "https://vixcloud.co/",
                "Origin" to "https://vixcloud.co",
                "Accept" to "*/*"
            ))

        // Use filesDir for persistent storage; cacheDir may be wiped by the system
        val cacheDir = File(context.filesDir, "streamo_downloads").apply { mkdirs() }

        // Single DatabaseProvider instance shared between SimpleCache and DownloadManager
        val databaseProvider = StandaloneDatabaseProvider(context)

        // NoOpCacheEvictor: downloaded content must NEVER be evicted. An LRU evictor
        // would drop the master playlist + early segments (written first) once a
        // download exceeds the cap, leaving "completed" downloads unplayable offline.
        _cache = SimpleCache(
            cacheDir,
            NoOpCacheEvictor(),
            databaseProvider
        )

        _cacheDataSourceFactory = CacheDataSource.Factory()
            .setCache(_cache!!)
            .setUpstreamDataSourceFactory(_httpDataSourceFactory!!)
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)

        // One download at a time to preserve bandwidth and provider rate-limits
        val downloadExecutor = Executors.newFixedThreadPool(1)
        _downloadManager = DownloadManager(
            context,
            databaseProvider,
            _cache!!,
            _httpDataSourceFactory!!,
            downloadExecutor
        )

        DownloadManagerSingleton.initialize(_downloadManager!!)
    }
}
