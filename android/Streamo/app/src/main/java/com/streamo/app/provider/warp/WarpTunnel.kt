package com.streamo.app.provider.warp

import android.content.Context
import com.streamo.app.data.preferences.SettingsDataStore
import com.streamo.app.provider.ProviderDebugLogger
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.InetSocketAddress
import java.net.Proxy
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.random.Random

/**
 * Userspace WireGuard egress for provider/playback traffic. Brings up an
 * in-process WireGuard tunnel to Cloudflare WARP (via [WarpEngine], the gomobile
 * build of `windtf/wireproxy`) that exposes a local HTTP proxy on loopback, and
 * hands callers an [OkHttpClient] whose requests egress through it — hiding the
 * device IP from StreamingCommunity/vixcloud without a system VPN.
 *
 * Android port of iOS `WarpTunnel`. Registration lives in Go ([WarpEngine.register]),
 * so this layer does no crypto — it stores the returned config and reuses it.
 */
@Singleton
class WarpTunnel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val settings: SettingsDataStore,
    private val baseClient: OkHttpClient,
) {
    private val mutex = Mutex()
    @Volatile private var tmpDirReady = false

    @Volatile private var proxyPort: Int = 0
    @Volatile private var running: Boolean = false
    @Volatile private var proxiedClient: OkHttpClient? = null

    /** Whether the gomobile engine is linked in this build. */
    val isAvailable: Boolean get() = WarpEngine.isAvailable

    /** Tunnel up and the local proxy bound. */
    val isReady: Boolean get() = running && proxyPort != 0 && proxiedClient != null

    /**
     * Register a fresh WARP account and persist its config. Runs the Cloudflare
     * registration in Go. Throws on failure (caller surfaces the message).
     */
    suspend fun register() = withContext(Dispatchers.IO) {
        val config = WarpEngine.register()
        settings.setWarpConfig(config)
        ProviderDebugLogger.log("WarpTunnel.register: account registered, config stored")
    }

    /**
     * Bring the tunnel up from the stored config. Idempotent: returns true if
     * already ready. Polls Cloudflare's trace through the proxy (≤10s) until the
     * WireGuard handshake completes before reporting ready, mirroring iOS.
     */
    suspend fun start(): Boolean = mutex.withLock {
        if (isReady) return@withLock true
        if (!WarpEngine.isAvailable) {
            ProviderDebugLogger.log("WarpTunnel.start: engine unavailable")
            return@withLock false
        }
        val baseConfig = settings.warpConfig.first()
        if (baseConfig.isNullOrBlank()) {
            ProviderDebugLogger.log("WarpTunnel.start: no stored config (not registered)")
            return@withLock false
        }

        val port = randomLoopbackPort()
        val fullConfig = buildString {
            append(baseConfig.trimEnd())
            append("\n\n[http]\nBindAddress = 127.0.0.1:")
            append(port)
            append('\n')
        }

        return@withLock withContext(Dispatchers.IO) {
            ensureWritableTmpDir()
            try {
                WarpEngine.start(fullConfig)
            } catch (e: Throwable) {
                ProviderDebugLogger.logError("WarpTunnel.start: engine failed", e)
                return@withContext false
            }
            proxyPort = port
            val client = buildProxiedClient(port)

            // Poll egress until the tunnel is up (handshake + a fresh key needs a
            // moment to activate on Cloudflare's side). Up to ~10s.
            repeat(20) { attempt ->
                if (attempt > 0) delay(500)
                if (probeEgress(client)) {
                    proxiedClient = client
                    running = true
                    ProviderDebugLogger.log("WarpTunnel.start: ready on 127.0.0.1:$port")
                    return@withContext true
                }
            }
            ProviderDebugLogger.logError("WarpTunnel.start: egress never came up — stopping")
            WarpEngine.stop()
            proxyPort = 0
            false
        }
    }

    fun stop() {
        WarpEngine.stop()
        running = false
        proxyPort = 0
        proxiedClient = null
    }

    /** OkHttpClient routed through the WARP proxy, or null when not ready. */
    fun proxiedClient(): OkHttpClient? = proxiedClient.takeIf { isReady }

    /** Fetch Cloudflare's trace through the proxy: `warp=on` + egress IP/colo. */
    suspend fun trace(): TraceResult? = withContext(Dispatchers.IO) {
        val client = proxiedClient() ?: return@withContext null
        try {
            val request = Request.Builder()
                .url("https://www.cloudflare.com/cdn-cgi/trace")
                .header("Cache-Control", "no-cache")
                .build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@withContext null
                val body = response.body?.string() ?: return@withContext null
                val fields = body.lineSequence()
                    .mapNotNull { line ->
                        val idx = line.indexOf('=')
                        if (idx <= 0) null else line.substring(0, idx) to line.substring(idx + 1)
                    }
                    .toMap()
                TraceResult(
                    warp = fields["warp"] == "on",
                    ip = fields["ip"],
                    colo = fields["colo"],
                )
            }
        } catch (e: Exception) {
            ProviderDebugLogger.logError("WarpTunnel.trace failed", e)
            null
        }
    }

    /**
     * The Go engine writes the wireproxy config via `os.CreateTemp("")`, which on
     * Android resolves to the non-writable `/data/local/tmp`. Redirect it to the
     * app cache dir through the engine's own `os.Setenv` (a host-side libc setenv
     * wouldn't reach Go's cached env). Idempotent.
     */
    private fun ensureWritableTmpDir() {
        if (tmpDirReady) return
        WarpEngine.setTmpDir(context.cacheDir.absolutePath)
        tmpDirReady = true
    }

    private fun buildProxiedClient(port: Int): OkHttpClient =
        baseClient.newBuilder()
            .proxy(Proxy(Proxy.Type.HTTP, InetSocketAddress("127.0.0.1", port)))
            .build()

    private suspend fun probeEgress(client: OkHttpClient): Boolean = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url("https://www.cloudflare.com/cdn-cgi/trace")
                .header("Cache-Control", "no-cache")
                .build()
            client.newCall(request).execute().use { it.isSuccessful }
        } catch (_: Exception) {
            false
        }
    }

    /** Ephemeral high loopback port for the proxy bind. */
    private fun randomLoopbackPort(): Int = Random.nextInt(39000, 49000)

    data class TraceResult(val warp: Boolean, val ip: String?, val colo: String?)
}
