package com.streamo.app.player.streamo

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.util.Log
import java.net.Inet4Address
import java.net.InetAddress
import com.google.gson.Gson
import com.streamo.app.player.cast.CastMedia
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

/**
 * Phone-side client per Streamo-to-Streamo cast.
 *
 * - NSD discovery di servizi [_streamo._tcp] sulla LAN
 * - HTTP commands (form-encoded) verso il server StreamoCastServer sulla TV
 */
class StreamoCastClient {

    private val gson = Gson()

    private val http = OkHttpClient.Builder()
        .connectTimeout(3, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .build()

    /**
     * Indirizzo host del servizio risolto, preferendo IPv4. Su API 34+ usa la lista
     * completa [NsdServiceInfo.getHostAddresses]; sotto, ricade su [NsdServiceInfo.host].
     */
    private fun pickIpv4Host(info: NsdServiceInfo): String? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val addrs: List<InetAddress> = info.hostAddresses
            addrs.firstOrNull { it is Inet4Address }?.let { return it.hostAddress }
            addrs.firstOrNull()?.hostAddress?.let { return it }
        }
        return info.host?.hostAddress
    }

    /** URL base del renderer (es. "http://192.168.1.42:9876"). IPv6 va tra parentesi quadre. */
    private fun StreamoRenderer.baseUrl(): String {
        val h = if (host.contains(':') && !host.startsWith("[")) "[$host]" else host
        return "http://$h:$port"
    }

    // --- Discovery ---

    /**
     * Scopre i dispositivi Streamo sulla LAN via NSD (_streamo._tcp).
     * Raccoglie per [timeoutMs] millisecondi, poi restituisce la lista.
     */
    suspend fun discover(context: Context, timeoutMs: Long = 5000): List<StreamoRenderer> =
        withContext(Dispatchers.IO) {
            val nsd = context.getSystemService(Context.NSD_SERVICE) as? NsdManager
            if (nsd == null) {
                Log.w(TAG, "NsdManager not available")
                return@withContext emptyList()
            }

            // MulticastLock: senza, molti device scartano le risposte mDNS in arrivo e
            // la discovery NSD ritorna 0 servizi. Richiede CHANGE_WIFI_MULTICAST_STATE.
            val multicastLock = runCatching {
                val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
                wifi?.createMulticastLock("streamo:discovery")?.apply {
                    setReferenceCounted(true)
                    acquire()
                }
            }.getOrNull()

            val renderers = mutableListOf<StreamoRenderer>()
            var discoveryListener: NsdManager.DiscoveryListener? = null

            // Un ResolveListener fresco per ogni resolveService: su API30+ riusare lo stesso
            // listener per resolve concorrenti fallisce con FAILURE_ALREADY_ACTIVE.
            fun newResolveListener() = object : NsdManager.ResolveListener {
                override fun onResolveFailed(serviceInfo: NsdServiceInfo?, errorCode: Int) {
                    Log.d(TAG, "resolve failed: ${serviceInfo?.serviceName} code=$errorCode")
                }
                override fun onServiceResolved(serviceInfo: NsdServiceInfo?) {
                    val info = serviceInfo ?: return
                    // Preferisci IPv4: il server NanoHTTPD ascolta su IPv4, e un IPv6
                    // link-local risolto da NSD darebbe "connection refused" → falso
                    // "TV non raggiungibile".
                    val host = pickIpv4Host(info) ?: return
                    val port = info.port
                    if (port <= 0) return
                    val name = info.serviceName ?: "Streamo"
                    val r = StreamoRenderer(friendlyName = name, host = host, port = port)
                    synchronized(renderers) {
                        if (renderers.none { it.host == host && it.port == port }) {
                            renderers.add(r)
                            Log.d(TAG, "resolved: $name @ $host:$port")
                        }
                    }
                }
            }

            try {
                suspendCancellableCoroutine<Unit> { cont ->
                    discoveryListener = object : NsdManager.DiscoveryListener {
                        override fun onDiscoveryStarted(serviceType: String?) {
                            Log.d(TAG, "discovery started for $serviceType")
                        }
                        override fun onDiscoveryStopped(serviceType: String?) {
                            Log.d(TAG, "discovery stopped")
                        }
                        override fun onStartDiscoveryFailed(serviceType: String?, errorCode: Int) {
                            Log.w(TAG, "start discovery failed: $errorCode")
                            if (!cont.isCompleted) cont.resume(Unit)
                        }
                        override fun onStopDiscoveryFailed(serviceType: String?, errorCode: Int) {
                            Log.w(TAG, "stop discovery failed: $errorCode")
                        }
                        override fun onServiceFound(serviceInfo: NsdServiceInfo?) {
                            val info = serviceInfo ?: return
                            if (info.serviceType?.contains("_streamo._tcp") == true) {
                                Log.d(TAG, "found: ${info.serviceName} → resolving")
                                nsd.resolveService(info, newResolveListener())
                            }
                        }
                        override fun onServiceLost(serviceInfo: NsdServiceInfo?) {
                            val info = serviceInfo ?: return
                            val host = info.host?.hostAddress ?: return
                            synchronized(renderers) { renderers.removeAll { it.host == host } }
                            Log.d(TAG, "lost: ${info.serviceName}")
                        }
                    }

                    nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener!!)

                    // Ferma la discovery dopo timeoutMs
                    val deadline = System.currentTimeMillis() + timeoutMs
                    while (System.currentTimeMillis() < deadline && !cont.isCompleted) {
                        Thread.sleep(200)
                    }
                    runCatching { nsd.stopServiceDiscovery(discoveryListener) }
                    if (!cont.isCompleted) cont.resume(Unit)
                }
            } catch (e: Exception) {
                Log.w(TAG, "discover failed", e)
            } finally {
                runCatching { nsd.stopServiceDiscovery(discoveryListener) }
                runCatching { if (multicastLock?.isHeld == true) multicastLock.release() }
            }

            renderers
        }

    // --- HTTP Commands ---

    suspend fun play(renderer: StreamoRenderer, media: CastMedia, startPositionMs: Long): Boolean =
        withContext(Dispatchers.IO) {
            Log.d(TAG, "play on ${renderer.friendlyName} tmdbId=${media.tmdbId}")
            val body = FormBody.Builder()
                .add("tmdbId", media.tmdbId.toString())
                .add("mediaType", media.mediaType)
                .add("season", media.season.toString())
                .add("episode", media.episode.toString())
                .add("title", media.title)
                .add("startPositionMs", startPositionMs.toString())
                .also { b ->
                    media.poster?.let { b.add("posterUrl", it) }
                    media.releaseDate?.let { b.add("releaseDate", it) }
                }
                .build()
            post(renderer, "/play", body)
        }

    suspend fun pause(renderer: StreamoRenderer): Boolean = withContext(Dispatchers.IO) {
        post(renderer, "/pause", FormBody.Builder().build())
    }

    suspend fun resume(renderer: StreamoRenderer): Boolean = withContext(Dispatchers.IO) {
        post(renderer, "/resume", FormBody.Builder().build())
    }

    suspend fun stop(renderer: StreamoRenderer): Boolean = withContext(Dispatchers.IO) {
        post(renderer, "/stop", FormBody.Builder().build())
    }

    suspend fun seek(renderer: StreamoRenderer, positionMs: Long): Boolean = withContext(Dispatchers.IO) {
        val body = FormBody.Builder()
            .add("positionMs", positionMs.toString())
            .build()
        post(renderer, "/seek", body)
    }

    suspend fun status(renderer: StreamoRenderer): StreamoStatus? = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder()
                .url("${renderer.baseUrl()}/status")
                .get()
                .build()
            http.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext null
                val json = resp.body?.string() ?: return@withContext null
                gson.fromJson(json, StreamoStatus::class.java)
            }
        } catch (e: Exception) {
            Log.w(TAG, "status failed", e)
            null
        }
    }

    private fun post(renderer: StreamoRenderer, path: String, body: FormBody): Boolean = try {
        val req = Request.Builder()
            .url("${renderer.baseUrl()}$path")
            .post(body)
            .build()
        http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) {
                Log.w(TAG, "$path -> HTTP ${resp.code}")
            }
            resp.isSuccessful
        }
    } catch (e: Exception) {
        Log.w(TAG, "$path failed", e)
        false
    }

    companion object {
        private const val TAG = "StreamoCastClient"
        private const val SERVICE_TYPE = "_streamo._tcp"
    }
}
