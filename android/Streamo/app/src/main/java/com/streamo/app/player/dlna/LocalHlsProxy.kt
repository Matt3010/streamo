package com.streamo.app.player.dlna

import android.util.Base64
import android.util.Log
import fi.iki.elonen.NanoHTTPD
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.URI
import java.util.concurrent.TimeUnit

/**
 * Proxy HTTP locale per servire uno stream HLS a una smart TV DLNA.
 *
 * Le TV DLNA (es. LG webOS) spesso non fetchano HTTPS e vogliono un URL con
 * estensione `.m3u8`. Questo proxy gira sul telefono in HTTP-cleartext sulla LAN:
 * la TV scarica da qui, il proxy fa da ponte verso vixcloud (HTTPS) e riscrive le
 * playlist così che ogni sub-playlist / segmento / chiave AES passi di nuovo dal proxy.
 *
 * @param masterUrl  URL assoluto della master playlist upstream (vixcloud, https).
 * @param headers    header da inoltrare upstream (vixcloud Referer/Origin; opzionali).
 * @param hostAddress IP della WiFi su cui bindare (così la TV lo raggiunge).
 */
class LocalHlsProxy(
    private val masterUrl: String,
    private val headers: Map<String, String>,
    private val hostAddress: String,
    upstreamClient: OkHttpClient? = null,
    // DLNA (LG webOS) sceglie da sola la variante peggiore: per quelle TV teniamo solo la
    // variante a BANDWIDTH massimo. Chromecast/Shaka fa ABR da sé e vuole il master COMPLETO:
    // trimmarlo a una sola variante demuxata rompe la riproduzione ai confini di discontinuità.
    private val singleVariant: Boolean = true
) : NanoHTTPD(hostAddress, 0) { // porta 0 = effimera

    // Quando la risoluzione passa da WARP, il token vixcloud è legato all'IP di egress di
    // Cloudflare: un fetch diretto (IP reale del telefono) viene rifiutato con 403. Riusa lo
    // stesso client proxato della riproduzione locale così l'upstream esce dallo stesso IP.
    private val http = upstreamClient ?: OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    /** URL base servito alla TV, valido dopo [start]. */
    val baseUrl: String get() = "http://$hostAddress:$listeningPort"

    /** URL .m3u8 da passare alla TV via SetAVTransportURI. */
    val streamUrl: String get() = "$baseUrl/stream.m3u8"

    private companion object {
        const val TAG = "DlnaCast"
        const val MIME_HLS = "application/vnd.apple.mpegurl"
    }

    override fun serve(session: IHTTPSession): Response {
        // Chromecast (Default Media Receiver = Shaka Player) fetcha playlist e segmenti via XHR
        // e impone CORS: senza questi header i segmenti vengono bloccati e la riproduzione resta
        // in buffering infinito. Le TV DLNA li ignorano, quindi è sicuro aggiungerli sempre.
        if (session.method == Method.OPTIONS) {
            return withCors(newFixedLengthResponse(Response.Status.OK, MIME_PLAINTEXT, ""))
        }
        val resp = try {
            when (session.uri) {
                "/stream.m3u8" -> serveResource(masterUrl)
                "/r" -> {
                    val enc = session.parameters["u"]?.firstOrNull()
                    if (enc == null) notFound() else serveResource(decode(enc))
                }
                else -> notFound()
            }
        } catch (e: Exception) {
            Log.w(TAG, "proxy serve error ${session.uri}", e)
            newFixedLengthResponse(Response.Status.INTERNAL_ERROR, MIME_PLAINTEXT, "proxy error")
        }
        return withCors(resp)
    }

    private fun withCors(resp: Response): Response = resp.apply {
        addHeader("Access-Control-Allow-Origin", "*")
        addHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        addHeader("Access-Control-Allow-Headers", "Content-Type, Range")
        addHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range")
    }

    /** Fetcha [upstreamUrl]: se è una playlist la riscrive, altrimenti la rilancia raw. */
    private fun serveResource(upstreamUrl: String): Response {
        Log.d(TAG, "fetch ${upstreamUrl.substringBefore('?').takeLast(45)}")
        val reqBuilder = Request.Builder().url(upstreamUrl)
        headers.forEach { (k, v) -> reqBuilder.addHeader(k, v) }
        val resp = http.newCall(reqBuilder.build()).execute()
        if (!resp.isSuccessful) {
            resp.close()
            Log.w(TAG, "upstream ${resp.code} per $upstreamUrl")
            return newFixedLengthResponse(
                Response.Status.lookup(resp.code) ?: Response.Status.INTERNAL_ERROR,
                MIME_PLAINTEXT, "upstream ${resp.code}"
            )
        }
        val contentType = resp.header("Content-Type").orEmpty()
        val isPlaylist = contentType.contains("mpegurl", ignoreCase = true) ||
            upstreamUrl.substringBefore('?').endsWith(".m3u8", ignoreCase = true)

        return if (isPlaylist) {
            val body = resp.body?.string().orEmpty()
            resp.close()
            val rewritten = rewritePlaylist(body, URI(upstreamUrl))
            newFixedLengthResponse(Response.Status.OK, MIME_HLS, rewritten)
        } else {
            // Segmenti / chiave. Il Default Media Receiver di Chromecast (Shaka) è molto più
            // severo di ExoPlayer: vuole una risposta con Content-Length, non chunked. Se
            // l'upstream dichiara la lunghezza, servila come fixed-length; altrimenti chunked.
            val mime = contentType.ifBlank { "application/octet-stream" }
            val len = resp.body!!.contentLength()
            val stream = resp.body!!.byteStream()
            if (len >= 0) {
                newFixedLengthResponse(Response.Status.OK, mime, stream, len)
            } else {
                newChunkedResponse(Response.Status.OK, mime, stream)
            }
        }
    }

    /**
     * Riscrive gli URI della playlist. Per il master: con [singleVariant] tiene solo la variante
     * migliore (DLNA), altrimenti riscrive il master COMPLETO proxando ogni variante (Chromecast).
     * [rewriteMedia] proxa qualunque riga-URI, quindi va bene anche per un master multivariante.
     */
    private fun rewritePlaylist(text: String, base: URI): String {
        val lines = text.lines()
        val isMaster = lines.any { it.trimStart().startsWith("#EXT-X-STREAM-INF") }
        if (!isMaster) {
            val hasEndlist = lines.any { it.trimStart().startsWith("#EXT-X-ENDLIST") }
            val type = lines.firstOrNull { it.trimStart().startsWith("#EXT-X-PLAYLIST-TYPE") }
                ?.substringAfter(':')?.trim()
            Log.d(TAG, "media playlist: endlist=$hasEndlist type=$type segmenti=${lines.count { it.trimStart().startsWith("#EXTINF") }}")
        }
        return if (isMaster && singleVariant) rewriteMasterKeepBest(lines, base)
        else rewriteMedia(lines, base)
    }

    /** Media playlist (lista segmenti): riscrive ogni URI verso il proxy. */
    private fun rewriteMedia(lines: List<String>, base: URI): String {
        val rewritten = lines.joinToString("\n") { line ->
            val trimmed = line.trim()
            when {
                trimmed.isEmpty() -> line
                trimmed.startsWith("#") ->
                    if (line.contains("URI=\"")) rewriteUriAttr(line, base) else line
                else -> proxify(base.resolve(trimmed).toString())
            }
        }
        // Chromecast/Shaka: una media playlist senza #EXT-X-ENDLIST è trattata come LIVE → la
        // ricarica di continuo e va in errore al "live edge" dopo pochi secondi. I film vixcloud
        // sono VOD: se manca ENDLIST e c'è almeno un segmento, forzalo così Shaka tratta lo
        // stream come VOD. NON tocca il path DLNA (singleVariant=true, ramo keepBest).
        val isMediaWithSegments = lines.any { it.trimStart().startsWith("#EXTINF") }
        val hasEndlist = lines.any { it.trimStart().startsWith("#EXT-X-ENDLIST") }
        return if (!singleVariant && isMediaWithSegments && !hasEndlist) {
            Log.d(TAG, "media playlist senza ENDLIST: forzo VOD per Chromecast")
            rewritten.trimEnd() + "\n#EXT-X-ENDLIST\n"
        } else {
            rewritten
        }
    }

    /**
     * Master multivariante: la DMR della TV (LG) sceglie da sola la variante e tende a
     * prendere la PIÙ BASSA (480p) senza salire. Teniamo solo quella a BANDWIDTH massimo
     * (= 1080p quando disponibile) + le tracce audio, così la TV riproduce la qualità top.
     */
    private fun rewriteMasterKeepBest(lines: List<String>, base: URI): String {
        val out = StringBuilder()
        var bestBw = -1
        var bestInf: String? = null
        var bestUri: String? = null
        var i = 0
        while (i < lines.size) {
            val line = lines[i]
            val trimmed = line.trim()
            if (trimmed.startsWith("#EXT-X-STREAM-INF")) {
                val bw = Regex("BANDWIDTH=(\\d+)").find(trimmed)?.groupValues?.get(1)?.toIntOrNull() ?: 0
                var j = i + 1
                while (j < lines.size && lines[j].trim().isEmpty()) j++
                val uri = if (j < lines.size) lines[j].trim() else ""
                if (bw > bestBw) { bestBw = bw; bestInf = line; bestUri = uri }
                i = j + 1
                continue
            }
            // Header e tracce audio/sottotitoli (EXT-X-MEDIA): mantieni, riscrivendo URI=".."
            if (trimmed.isNotEmpty()) {
                out.append(if (trimmed.startsWith("#") && line.contains("URI=\"")) rewriteUriAttr(line, base) else line)
                out.append("\n")
            }
            i++
        }
        if (bestInf != null && bestUri != null) {
            Log.d(TAG, "master: tengo solo variante a BANDWIDTH=$bestBw")
            out.append(bestInf).append("\n")
            out.append(proxify(base.resolve(bestUri!!).toString())).append("\n")
        }
        return out.toString()
    }

    private fun rewriteUriAttr(line: String, base: URI): String =
        Regex("URI=\"([^\"]*)\"").replace(line) { m ->
            "URI=\"${proxify(base.resolve(m.groupValues[1]).toString())}\""
        }

    private fun proxify(absoluteUrl: String): String = "$baseUrl/r?u=${encode(absoluteUrl)}"

    private fun encode(s: String): String =
        Base64.encodeToString(s.toByteArray(), Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

    private fun decode(s: String): String =
        String(Base64.decode(s, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING))

    private fun notFound() =
        newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "not found")
}
