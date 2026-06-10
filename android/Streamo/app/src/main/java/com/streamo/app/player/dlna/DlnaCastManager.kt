package com.streamo.app.player.dlna

import android.content.Context
import android.net.wifi.WifiManager
import android.util.Log
import fi.iki.elonen.NanoHTTPD
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.URI
import java.util.concurrent.TimeUnit

/** Un Media Renderer DLNA scoperto in rete (es. una smart TV). */
data class DlnaRenderer(
    val friendlyName: String,
    /** URL assoluto del control endpoint del servizio AVTransport. */
    val controlUrl: String
)

/** Posizione/durata correnti riportate dalla TV. */
data class DlnaPosition(val positionMs: Long, val durationMs: Long)

/**
 * Client DLNA/UPnP minimale: scopre i Media Renderer (SSDP) e invia uno stream
 * via AVTransport (SetAVTransportURI + Play). Pensato come PoC per castare su TV
 * che NON supportano Google Cast (es. LG webOS, Samsung Tizen).
 *
 * Implementazione a mano (niente Cling/jUPnP): solo OkHttp + DatagramSocket.
 */
class DlnaCastManager {

    private val http = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .build()

    /** L'AVTransport della TV gestisce una richiesta per volta: serializza le SOAP. */
    private val soapMutex = Mutex()

    private companion object {
        const val TAG = "DlnaCast"
        const val SSDP_ADDR = "239.255.255.250"
        const val SSDP_PORT = 1900
        const val AVT = "urn:schemas-upnp-org:service:AVTransport:1"
    }

    /** SSDP M-SEARCH → raccoglie i renderer per ~[timeoutMs]. Va su Dispatchers.IO. */
    suspend fun discover(context: Context, timeoutMs: Long = 5000): List<DlnaRenderer> =
        withContext(Dispatchers.IO) {
            val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            val lock = wifi?.createMulticastLock("streamo-dlna")?.apply {
                setReferenceCounted(true)
                runCatching { acquire() }
            }
            val localAddr = wifiIpv4Address()
            Log.d(TAG, "discover start: localWifiAddr=$localAddr")
            val locations = mutableSetOf<String>()
            var responseCount = 0
            try {
                // ST diverse: alcuni renderer rispondono solo a ssdp:all, altri al device/service.
                val searchTargets = listOf(
                    "ssdp:all",
                    "urn:schemas-upnp-org:device:MediaRenderer:1",
                    "urn:schemas-upnp-org:service:AVTransport:1"
                )
                val group = InetAddress.getByName(SSDP_ADDR)

                DatagramSocket(null).use { socket ->
                    socket.reuseAddress = true
                    socket.broadcast = true
                    // Bind all'IP WiFi così i pacchetti escono dall'interfaccia giusta
                    // (non dalla rete dati cellulare).
                    socket.bind(InetSocketAddress(localAddr ?: InetAddress.getByName("0.0.0.0"), 0))
                    socket.soTimeout = 800
                    Log.d(TAG, "socket bound to ${socket.localAddress}:${socket.localPort}")

                    fun sendSearches() {
                        searchTargets.forEach { st ->
                            val msg = ("M-SEARCH * HTTP/1.1\r\n" +
                                "HOST: $SSDP_ADDR:$SSDP_PORT\r\n" +
                                "MAN: \"ssdp:discover\"\r\n" +
                                "MX: 2\r\n" +
                                "ST: $st\r\n\r\n").toByteArray()
                            runCatching { socket.send(DatagramPacket(msg, msg.size, group, SSDP_PORT)) }
                        }
                    }

                    // Rilancia l'M-SEARCH ogni ~1s per tutta la finestra: alcune TV (LG)
                    // dopo uno Stop vanno offline da UPnP e rispondono solo qualche secondo
                    // dopo, oppure il primo pacchetto si perde.
                    val deadline = System.currentTimeMillis() + timeoutMs
                    var lastSend = 0L
                    val buf = ByteArray(4096)
                    while (System.currentTimeMillis() < deadline) {
                        val nowMs = System.currentTimeMillis()
                        if (nowMs - lastSend >= 900) {
                            sendSearches()
                            lastSend = nowMs
                        }
                        val packet = DatagramPacket(buf, buf.size)
                        try {
                            socket.receive(packet)
                        } catch (_: Exception) {
                            continue // timeout receive → ritenta finché non scade il deadline
                        }
                        responseCount++
                        val resp = String(packet.data, 0, packet.length)
                        val loc = locationOf(resp)
                        if (loc != null && locations.add(loc)) {
                            Log.d(TAG, "nuova location da ${packet.address?.hostAddress}: $loc")
                        }
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "discover failed", e)
            } finally {
                runCatching { lock?.release() }
            }

            Log.d(TAG, "discover: $responseCount risposte, ${locations.size} location uniche")
            val renderers = locations.mapNotNull { loc ->
                runCatching { fetchRenderer(loc) }
                    .onFailure { Log.w(TAG, "fetchRenderer failed loc=$loc", it) }
                    .getOrNull()
            }.distinctBy { it.controlUrl }
            Log.d(TAG, "discover done: ${renderers.size} renderer -> ${renderers.map { it.friendlyName }}")
            renderers
        }

    /** IPv4 dell'interfaccia di rete attiva (WiFi), per bindare il socket SSDP. */
    private fun wifiIpv4Address(): InetAddress? = runCatching {
        NetworkInterface.getNetworkInterfaces().asSequence()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.asSequence() }
            .firstOrNull { it is Inet4Address && it.isSiteLocalAddress }
    }.getOrNull()

    private fun locationOf(ssdpResponse: String): String? =
        ssdpResponse.lineSequence()
            .firstOrNull { it.startsWith("LOCATION:", ignoreCase = true) }
            ?.substring("LOCATION:".length)
            ?.trim()
            ?.ifBlank { null }

    /** Scarica la device description e ne estrae nome + control URL dell'AVTransport. */
    private fun fetchRenderer(location: String): DlnaRenderer? {
        val xml = http.newCall(Request.Builder().url(location).build()).execute().use { resp ->
            if (!resp.isSuccessful) return null
            resp.body?.string() ?: return null
        }
        // base per risolvere URL relativi: <URLBase> se presente, altrimenti la LOCATION.
        val urlBase = Regex("<URLBase>(.*?)</URLBase>", RegexOption.DOT_MATCHES_ALL)
            .find(xml)?.groupValues?.get(1)?.trim()?.ifBlank { null }
        val base = URI(urlBase ?: location)

        val name = Regex("<friendlyName>(.*?)</friendlyName>", RegexOption.DOT_MATCHES_ALL)
            .find(xml)?.groupValues?.get(1)?.trim()?.let { unescapeXml(it) } ?: "Dispositivo DLNA"

        // Trova il blocco <service> dell'AVTransport e il suo <controlURL>.
        val service = Regex("<service>(.*?)</service>", RegexOption.DOT_MATCHES_ALL)
            .findAll(xml)
            .map { it.groupValues[1] }
            .firstOrNull { it.contains(AVT) }
        if (service == null) {
            Log.d(TAG, "device '$name' ($location) senza AVTransport → scartato")
            return null
        }
        val control = Regex("<controlURL>(.*?)</controlURL>", RegexOption.DOT_MATCHES_ALL)
            .find(service)?.groupValues?.get(1)?.trim()?.let { unescapeXml(it) } ?: return null

        val controlUrl = base.resolve(control).toString()
        return DlnaRenderer(name, controlUrl)
    }

    private var proxy: LocalHlsProxy? = null

    /**
     * Avvia il proxy HLS locale e invia alla TV l'URL proxato (http, .m3u8) via
     * SetAVTransportURI + Play. Le TV DLNA non fetchano vixcloud https direttamente.
     */
    suspend fun play(
        renderer: DlnaRenderer,
        streamUrl: String,
        headers: Map<String, String>,
        title: String
    ): Boolean = withContext(Dispatchers.IO) {
        Log.d(TAG, "play su '${renderer.friendlyName}' url=$streamUrl")
        stopProxy()
        val host = wifiIpv4Address()?.hostAddress
        if (host == null) {
            Log.w(TAG, "nessun IP WiFi: impossibile avviare il proxy")
            return@withContext false
        }
        val p = LocalHlsProxy(streamUrl, headers, host)
        val served = try {
            p.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
            p.streamUrl
        } catch (e: Exception) {
            Log.w(TAG, "avvio proxy fallito", e)
            return@withContext false
        }
        proxy = p
        Log.d(TAG, "proxy avviato, servo alla TV: $served")

        // Tentativo 1: con metadata DIDL. Tentativo 2: metadata vuoto (alcune TV lo
        // preferiscono e inferiscono il tipo dall'URL).
        val setOk = setUri(renderer, served, didl(served, title)) ||
            setUri(renderer, served, "")
        if (!setOk) {
            stopProxy()
            return@withContext false
        }
        Thread.sleep(400)
        // Play ESPLICITO necessario: col solo SetAVTransportURI questa TV legge il master
        // ma non avvia il download di sub-playlist/segmenti. Best-effort: la TV esegue il
        // Play anche se la risposta HTTP va in timeout (la ignoriamo). Il polling posizione
        // usa tryLock, quindi questo eventuale blocco di ~5s non congela i controlli.
        runCatching {
            soapCall(renderer.controlUrl, "Play", soap("Play", "<InstanceID>0</InstanceID><Speed>1</Speed>"))
        }
        true
    }

    private fun stopProxy() {
        runCatching { proxy?.stop() }
        proxy = null
    }

    private suspend fun setUri(renderer: DlnaRenderer, url: String, metadata: String): Boolean {
        val body = soap(
            "SetAVTransportURI",
            """
            <InstanceID>0</InstanceID>
            <CurrentURI>${escapeXml(url)}</CurrentURI>
            <CurrentURIMetaData>${escapeXml(metadata)}</CurrentURIMetaData>
            """.trimIndent()
        )
        return soapCall(renderer.controlUrl, "SetAVTransportURI", body)
    }

    suspend fun pause(renderer: DlnaRenderer): Boolean = withContext(Dispatchers.IO) {
        soapCall(renderer.controlUrl, "Pause", soap("Pause", "<InstanceID>0</InstanceID>"))
    }

    suspend fun resume(renderer: DlnaRenderer): Boolean = withContext(Dispatchers.IO) {
        soapCall(renderer.controlUrl, "Play", soap("Play", "<InstanceID>0</InstanceID><Speed>1</Speed>"))
    }

    suspend fun stop(renderer: DlnaRenderer): Boolean = withContext(Dispatchers.IO) {
        val ok = soapCall(renderer.controlUrl, "Stop", soap("Stop", "<InstanceID>0</InstanceID>"))
        stopProxy()
        ok
    }

    /** Seek assoluto a [positionMs]. Prova REL_TIME poi ABS_TIME (alcune TV vogliono l'uno o l'altro). */
    suspend fun seek(renderer: DlnaRenderer, positionMs: Long): Boolean = withContext(Dispatchers.IO) {
        val target = formatTime(positionMs)
        seekUnit(renderer, "REL_TIME", target) || seekUnit(renderer, "ABS_TIME", target)
    }

    private suspend fun seekUnit(renderer: DlnaRenderer, unit: String, target: String): Boolean {
        val body = soap("Seek", "<InstanceID>0</InstanceID><Unit>$unit</Unit><Target>$target</Target>")
        return soapCall(renderer.controlUrl, "Seek", body)
    }

    /**
     * Posizione/durata dalla TV (GetPositionInfo). Usa tryLock: se un comando
     * (seek/play/pause) sta occupando l'AVTransport, salta questo tick invece di
     * accodarsi — così il polling non congela mai i controlli.
     */
    suspend fun positionInfo(renderer: DlnaRenderer): DlnaPosition? = withContext(Dispatchers.IO) {
        if (!soapMutex.tryLock()) return@withContext null
        val body = try {
            rawQuery(renderer.controlUrl, "GetPositionInfo", soap("GetPositionInfo", "<InstanceID>0</InstanceID>"))
        } finally {
            soapMutex.unlock()
        } ?: return@withContext null
        val pos = parseTime(Regex("<RelTime>(.*?)</RelTime>").find(body)?.groupValues?.get(1))
        val dur = parseTime(Regex("<TrackDuration>(.*?)</TrackDuration>").find(body)?.groupValues?.get(1))
        DlnaPosition(pos, dur)
    }

    /**
     * Stato di trasporto della TV (GetTransportInfo) → CurrentTransportState:
     * "PLAYING" | "PAUSED_PLAYBACK" | "STOPPED" | "TRANSITIONING" | "NO_MEDIA_PRESENT".
     * Usa tryLock come [positionInfo]: se un comando occupa l'AVTransport, salta il tick.
     */
    suspend fun transportState(renderer: DlnaRenderer): String? = withContext(Dispatchers.IO) {
        if (!soapMutex.tryLock()) return@withContext null
        val body = try {
            rawQuery(renderer.controlUrl, "GetTransportInfo", soap("GetTransportInfo", "<InstanceID>0</InstanceID>"))
        } finally {
            soapMutex.unlock()
        } ?: return@withContext null
        Regex("<CurrentTransportState>(.*?)</CurrentTransportState>")
            .find(body)?.groupValues?.get(1)?.trim()?.ifBlank { null }
    }

    /** ms → "H:MM:SS" per il campo Target/REL_TIME. */
    private fun formatTime(ms: Long): String {
        val total = (ms / 1000).coerceAtLeast(0)
        return "%d:%02d:%02d".format(total / 3600, (total % 3600) / 60, total % 60)
    }

    /** "HH:MM:SS(.mmm)" → ms. 0 se null/non parsabile. */
    private fun parseTime(value: String?): Long {
        val parts = value?.trim()?.split(":") ?: return 0
        if (parts.size != 3) return 0
        val h = parts[0].toLongOrNull() ?: 0
        val m = parts[1].toLongOrNull() ?: 0
        val s = parts[2].substringBefore('.').toLongOrNull() ?: 0
        return ((h * 3600 + m * 60 + s) * 1000)
    }

    // Wrapper serializzati (una SOAP per volta verso la TV).
    private suspend fun soapCall(controlUrl: String, action: String, body: String): Boolean =
        soapMutex.withLock { rawCall(controlUrl, action, body) }

    // --- HTTP grezzo, SENZA mutex (chiamato solo da soapCall/positionInfo che già lockano). ---

    private fun rawCall(controlUrl: String, action: String, body: String): Boolean = try {
        val req = Request.Builder()
            .url(controlUrl)
            .addHeader("SOAPACTION", "\"$AVT#$action\"")
            .post(body.toRequestBody("text/xml; charset=\"utf-8\"".toMediaType()))
            .build()
        http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) {
                val b = resp.body?.string().orEmpty()
                val code = Regex("<errorCode>(.*?)</errorCode>").find(b)?.groupValues?.get(1)
                val desc = Regex("<errorDescription>(.*?)</errorDescription>").find(b)?.groupValues?.get(1)
                Log.w(TAG, "$action -> HTTP ${resp.code} UPnP errorCode=$code desc=$desc")
            }
            resp.isSuccessful
        }
    } catch (e: Exception) {
        Log.w(TAG, "$action failed", e)
        false
    }

    private fun rawQuery(controlUrl: String, action: String, body: String): String? = try {
        val req = Request.Builder()
            .url(controlUrl)
            .addHeader("SOAPACTION", "\"$AVT#$action\"")
            .post(body.toRequestBody("text/xml; charset=\"utf-8\"".toMediaType()))
            .build()
        http.newCall(req).execute().use { resp ->
            if (resp.isSuccessful) resp.body?.string() else null
        }
    } catch (e: Exception) {
        Log.w(TAG, "$action query failed", e)
        null
    }

    private fun soap(action: String, inner: String): String = """
        <?xml version="1.0" encoding="utf-8"?>
        <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
         <s:Body>
          <u:$action xmlns:u="$AVT">
           $inner
          </u:$action>
         </s:Body>
        </s:Envelope>
    """.trimIndent()

    /** DIDL-Lite minimale; protocolInfo HLS. Alcune TV lo ignorano, altre lo richiedono. */
    private fun didl(url: String, title: String): String = """
        <DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
         <item id="0" parentID="-1" restricted="1">
          <dc:title>${escapeXml(title)}</dc:title>
          <upnp:class>object.item.videoItem</upnp:class>
          <res protocolInfo="http-get:*:application/x-mpegURL:*">${escapeXml(url)}</res>
         </item>
        </DIDL-Lite>
    """.trimIndent()

    private fun escapeXml(s: String): String = s
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
        .replace("'", "&apos;")

    private fun unescapeXml(s: String): String = s
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}
