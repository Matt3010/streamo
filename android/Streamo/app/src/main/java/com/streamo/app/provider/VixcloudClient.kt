package com.streamo.app.provider

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Turns a vixcloud `/embed/<id>` URL into a directly-playable HLS master
 * playlist URL. This replaces the web app's nginx playlist proxy + JWPlayer
 * iframe: instead of letting a player inside a webview build the URL, we
 * scrape the embed page and reconstruct it ourselves.
 *
 * Port of iOS VixcloudClient.swift.
 */
@Singleton
class VixcloudClient @Inject constructor(
    private val client: OkHttpClient
) {
    /** Active HTTP client, swapped to a WARP-proxied client when IP-masking is
     * on (see [com.streamo.app.provider.ProviderResolver.prepareWARP]). */
    @Volatile
    private var activeClient: OkHttpClient = client

    fun setClient(c: OkHttpClient) { activeClient = c }
    fun resetClient() { activeClient = client }

    companion object {
        // ponytail: realistic desktop Chrome UA — bare "Mozilla/5.0" is a bot fingerprint; upgrade to a full browser string.
        private const val USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/126.0.0.0 Safari/537.36"

        /** Headers vixcloud expects (the web proxy spoofed these on the playlist). */
        val playbackHeaders: Map<String, String> = mapOf(
            "Referer" to "https://vixcloud.co/",
            "Origin" to "https://vixcloud.co"
        )

        // Regex patterns for extracting JS variables from the embed page.
        // Tried in order; first match wins.
        private val TOKEN_PATTERNS = listOf(
            Regex("""'token'\s*:\s*'([^']+)'"""),
            Regex(""""token"\s*:\s*"([^"]+)""""),
            Regex("""token:\s*'([^']+)'"""),
            Regex("""token:\s*"([^"]+)"""")
        )
        private val EXPIRES_PATTERNS = listOf(
            Regex("""'expires'\s*:\s*'([^']+)'"""),
            Regex(""""expires"\s*:\s*"([^"]+)""""),
            Regex("""expires:\s*'([^']+)'"""),
            Regex("""expires:\s*"([^"]+)"""")
        )
        private val URL_PATTERNS = listOf(
            Regex("""url:\s*'([^']+)'"""),
            Regex("""url:\s*"([^"]+)""""),
            Regex(""""url"\s*:\s*"([^"]+)"""")
        )
        private val CAN_PLAY_FHD_PATTERN = Regex("""window\.canPlayFHD\s*=\s*(true|false)""")
        private val STREAMS_PATTERN = Regex("""window\.streams\s*=\s*(\[.*?])""", RegexOption.DOT_MATCHES_ALL)
    }

    /**
     * Resolve an embed URL to an ordered list of playable sources: the master
     * playlist first, then the alternate servers from `window.streams`.
     * The player falls back down the list when one fails.
     */
    suspend fun playbackSources(embedUrl: String): List<PlaybackSource> {
        ProviderDebugLogger.log("VixcloudClient.playbackSources: embedUrl=$embedUrl")
        val html = fetchHTML(embedUrl) ?: throw VixError.FetchFailed.also {
            ProviderDebugLogger.logError("VixcloudClient.playbackSources: fetchHTML returned null")
        }
        ProviderDebugLogger.log("VixcloudClient.playbackSources: fetched HTML length=${html.length}")
        val urls = buildPlaylistURLs(html)
        ProviderDebugLogger.log("VixcloudClient.playbackSources: built ${urls.size} playlist URLs")
        urls.forEachIndexed { i, url ->
            ProviderDebugLogger.log("  source #${i + 1}: $url")
        }
        if (urls.isEmpty()) throw VixError.PlaylistNotFound.also {
            ProviderDebugLogger.logError("VixcloudClient.playbackSources: no playlist URLs found")
        }
        return urls.map { PlaybackSource(playlistUrl = it, headers = playbackHeaders) }
    }

    /** Raw embed HTML — for debugging. */
    suspend fun debugEmbedHTML(embedUrl: String): String? = fetchHTML(embedUrl)

    private suspend fun fetchHTML(urlString: String): String? = withContext(Dispatchers.IO) {
        try {
            ProviderDebugLogger.log("VixcloudClient.fetchHTML: GET $urlString")
            val request = Request.Builder()
                .url(urlString)
                .header("Accept", "text/html,application/xhtml+xml,*/*")
                .header("User-Agent", USER_AGENT)
                .build()
            val response = activeClient.newCall(request).execute()
            if (!response.isSuccessful) {
                ProviderDebugLogger.logError("VixcloudClient.fetchHTML: HTTP ${response.code}")
                return@withContext null
            }
            val body = response.body?.string()
            ProviderDebugLogger.log("VixcloudClient.fetchHTML: success, body=${body?.length ?: 0} chars")
            body
        } catch (e: Exception) {
            ProviderDebugLogger.logError("VixcloudClient.fetchHTML: exception", e)
            null
        }
    }

    // region Extraction

    /**
     * Build the HLS master playlist URLs from the embed page HTML.
     *
     * Vixcloud embed pages expose:
     * ```
     * window.masterPlaylist = { params: { token: '…', expires: '…' }, url: 'https://vixcloud.co/playlist/<id>' }
     * window.canPlayFHD = true
     * window.streams = [ { name: "...", active: true, url: "..." } ]
     * ```
     *
     * We extract url, token, expires (tolerant to quote style) and append
     * `&h=1` when FHD is allowed.
     */
    fun buildPlaylistURLs(html: String): List<String> {
        val token = extractFirst(html, TOKEN_PATTERNS)
        val expires = extractFirst(html, EXPIRES_PATTERNS)
        val canFHD = extractFirst(html, listOf(CAN_PLAY_FHD_PATTERN)) == "true"
        ProviderDebugLogger.log("VixcloudClient.buildPlaylistURLs: token=${token != null} expires=${expires != null} canFHD=$canFHD")

        fun withParams(base: String): String? {
            val parsed = base.trim().toHttpUrlOrNull() ?: return null
            val builder = parsed.newBuilder()
            if (token != null && parsed.queryParameter("token") == null) {
                builder.addQueryParameter("token", token)
            }
            if (expires != null && parsed.queryParameter("expires") == null) {
                builder.addQueryParameter("expires", expires)
            }
            if (canFHD && parsed.queryParameter("h") == null) {
                builder.addQueryParameter("h", "1")
            }
            return builder.build().toString()
        }

        val bases = mutableListOf<String>()

        // Primary: masterPlaylist.url
        extractFirst(html, URL_PATTERNS)?.let {
            ProviderDebugLogger.log("VixcloudClient.buildPlaylistURLs: found master url=$it")
            bases.add(it)
        }

        // Alternates: window.streams (active first)
        val streams = parseStreams(html)
        ProviderDebugLogger.log("VixcloudClient.buildPlaylistURLs: found ${streams.size} alternate streams")
        streams
            .sortedBy { if (it.active == true) 0 else 1 }
            .forEach { stream ->
                stream.url?.let { url ->
                    // Streams URLs are JSON-escaped: replace \/ with /
                    bases.add(url.replace("\\/", "/"))
                }
            }

        return bases.mapNotNull { withParams(it) }.distinct()
    }

    private data class StreamEntry(
        val name: String?,
        val active: Boolean?,
        val url: String?
    )

    private fun parseStreams(html: String): List<StreamEntry> {
        val match = STREAMS_PATTERN.find(html) ?: return emptyList()
        val jsonStr = match.groupValues[1]
        return try {
            val arr = org.json.JSONArray(jsonStr)
            (0 until arr.length()).map { i ->
                val obj = arr.optJSONObject(i)
                StreamEntry(
                    name = obj?.optString("name"),
                    active = obj?.optBoolean("active", false),
                    url = obj?.optString("url")
                )
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun extractFirst(text: String, patterns: List<Regex>): String? {
        for (pattern in patterns) {
            val match = pattern.find(text)
            if (match != null && match.groupValues.size > 1) {
                return match.groupValues[1]
            }
        }
        return null
    }

    // endregion

    sealed class VixError : Exception() {
        object FetchFailed : VixError() {
            override val message: String get() = "Impossibile contattare il provider video."
        }
        object PlaylistNotFound : VixError() {
            override val message: String get() = "Stream non trovato nella pagina del player."
        }
    }
}