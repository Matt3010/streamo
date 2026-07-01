package com.streamo.app.provider.anime

import com.google.gson.Gson
import com.streamo.app.data.preferences.SettingsDataStore
import com.streamo.app.provider.ProviderClient
import com.streamo.app.provider.ProviderDebugLogger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Scrapes AnimeUnity's JSON endpoints into the app's anime catalog. Native
 * (own ids, no TMDB). The video path stops at a vixcloud embed URL, which
 * [com.streamo.app.provider.VixcloudClient] then resolves exactly like
 * StreamingCommunity — so this client only owns search/browse/episodes/embed-url.
 *
 * AnimeUnity is Laravel + Livewire: the JSON endpoints need a CSRF token
 * (`<meta name="csrf-token">` from the homepage) plus the `animeunity_session`
 * cookie (held by [AnimeUnityCookieJar]). The token is cached and re-bootstrapped
 * on a 419 (token expired). Port of iOS `AnimeUnityClient.swift`.
 */
@Singleton
class AnimeUnityClient @Inject constructor(
    @AnimeUnityHttpClient private val client: OkHttpClient,
    private val cookieJar: AnimeUnityCookieJar,
    private val settings: SettingsDataStore
) {
    /**
     * HTTP client used for every request. Swapped to a WARP-proxied client by
     * [com.streamo.app.provider.ProviderResolver.prepareWARP] when IP-masking is
     * on, and reset to the direct [client] otherwise. Mirrors iOS `setSession`:
     * swapping the client drops the cached CSRF token (cookies are bound to a
     * session) so the next call re-bootstraps through the new egress.
     */
    @Volatile
    private var activeClient: OkHttpClient = client

    // Raw source client behind [activeClient]. [activeClient] is a rebuilt wrapper
    // (cookie jar re-attached), so comparing the incoming client against it would
    // always differ and drop the CSRF token on every call. Compare against the
    // source instead, so the token is only reset on a genuine client swap.
    @Volatile
    private var activeSource: OkHttpClient = client

    fun setClient(c: OkHttpClient) {
        if (c !== activeSource) {
            csrfToken = null
            csrfFetchedAt = null
        }
        activeSource = c
        // The proxied WARP client doesn't carry our cookie jar: rebuild it so the
        // `animeunity_session` cookie (paired with the CSRF token) survives the swap.
        activeClient = c.newBuilder().cookieJar(cookieJar).build()
    }

    fun resetClient() {
        if (activeSource !== client) {
            csrfToken = null
            csrfFetchedAt = null
        }
        activeSource = client
        activeClient = client
    }

    /** Drop the cached CSRF token (forces re-bootstrap on next POST). */
    fun invalidateSession() {
        csrfToken = null
        csrfFetchedAt = null
        cookieJar.clear()
    }

    sealed class AUError : Exception() {
        object Network : AUError() {
            override val message: String get() = "Impossibile contattare AnimeUnity."
        }
        object NotAuthenticated : AUError() {
            override val message: String get() = "Sessione AnimeUnity non valida."
        }
        object NotFound : AUError() {
            override val message: String get() = "Contenuto non trovato."
        }
    }

    private val gson = Gson()

    // region Catalog

    /** Live search by title. */
    suspend fun search(query: String): List<AUAnime> = withContext(Dispatchers.IO) {
        val q = query.trim()
        if (q.isEmpty()) return@withContext emptyList()
        val data = try {
            postForm("/livesearch", form = mapOf("title" to q))
        } catch (e: Exception) {
            ProviderDebugLogger.logError("AnimeUnityClient.search: failed", e)
            return@withContext emptyList()
        }
        parseRecords(data)
    }

    /**
     * Browse the archive. [offset] paginates 30 at a time. [order] mirrors the
     * site's options ("Più visti", "Ultime aggiunte", "Popolarità", …).
     */
    suspend fun browse(offset: Int = 0, order: String = DEFAULT_ORDER): List<AUAnime> =
        withContext(Dispatchers.IO) {
            val body = mapOf(
                "title" to false, "type" to false, "year" to false,
                "order" to order, "status" to false, "genres" to false,
                "offset" to offset, "dubbed" to false, "season" to false
            )
            val data = try {
                postJSON("/archivio/get-animes", body)
            } catch (e: Exception) {
                ProviderDebugLogger.logError("AnimeUnityClient.browse: failed", e)
                return@withContext emptyList()
            }
            parseRecords(data)
        }

    /**
     * `info_api` caps the episode window at [EPISODE_CHUNK] per call (a larger
     * span returns an empty list), so the detail page pages by window.
     */
    suspend fun episodePage(animeId: Int, start: Int, end: Int): AUEpisodePage =
        withContext(Dispatchers.IO) {
            // Garantisce il cookie `animeunity_session`: aprendo il dettaglio (o riprendendo
            // dal "Continua a guardare") a freddo, nessun POST browse ha ancora bootstrappato
            // la sessione. csrf() è cached (TTL 20 min) → nessun GET extra se già attiva.
            ensureSession()
            val base = baseURL()
            val url = "$base/info_api/$animeId/1?start_range=$start&end_range=$end"
            val data = get(url, xhr = true) ?: throw AUError.Network
            val info = try {
                gson.fromJson(data, AUInfoResponse::class.java)
            } catch (_: Exception) {
                throw AUError.NotFound
            }
            // `hidden` looks like a visibility flag but isn't: AnimeUnity's own detail
            // page embeds hidden episodes into its Vue component unfiltered, and a
            // hidden-flagged episode still resolves to a playable embed URL. Some
            // titles (e.g. donghua batches) mark most episodes hidden=1, so filtering
            // on it here was dropping real episodes down to just the first/last.
            val episodes = info.episodes ?: emptyList()
            AUEpisodePage(episodes = episodes, total = info.episodesCount ?: episodes.size)
        }

    /**
     * Resolve an AnimeUnity episode id to its vixcloud embed URL (the plaintext
     * `GET /embed-url/{id}` response). Feed straight into `VixcloudClient`.
     */
    suspend fun embedURL(episodeId: Int, animeId: Int, slug: String?): String =
        withContext(Dispatchers.IO) {
            // Resume a freddo: assicura la sessione prima dell'embed (vedi episodePage).
            ensureSession()
            val base = baseURL()
            val request = Request.Builder()
                .url("$base/embed-url/$episodeId")
                .header("X-Requested-With", "XMLHttpRequest")
                .header("User-Agent", USER_AGENT)
                .also { if (!slug.isNullOrBlank()) it.header("Referer", "$base/anime/$animeId-$slug") }
                .build()
            ProviderDebugLogger.log("AnimeUnityClient.embedURL: GET $base/embed-url/$episodeId")
            val response = try {
                activeClient.newCall(request).execute()
            } catch (e: Exception) {
                ProviderDebugLogger.logError("AnimeUnityClient.embedURL: exception", e)
                throw AUError.Network
            }
            response.use {
                if (!it.isSuccessful) {
                    ProviderDebugLogger.logError("AnimeUnityClient.embedURL: HTTP ${it.code}")
                    throw AUError.Network
                }
                val raw = (it.body?.string() ?: "").trim()
                ProviderDebugLogger.log("AnimeUnityClient.embedURL: raw=$raw")
                val parsed = try {
                    java.net.URL(raw)
                } catch (_: Exception) {
                    throw AUError.NotFound
                }
                if (parsed.host != "vixcloud.co" || !parsed.path.startsWith("/embed/")) {
                    ProviderDebugLogger.logError("AnimeUnityClient.embedURL: rejected host=${parsed.host} path=${parsed.path}")
                    throw AUError.NotFound
                }
                parsed.toString()
            }
        }

    // endregion

    // region CSRF bootstrap

    /** Fetch (or reuse) the homepage CSRF token. The paired `animeunity_session`
     *  cookie is captured by [cookieJar] as a side effect. */
    private val csrfMutex = Mutex()
    private suspend fun csrf(): String = csrfMutex.withLock {
        val cached = csrfToken
        val fetchedAt = csrfFetchedAt
        if (cached != null && fetchedAt != null &&
            System.currentTimeMillis() - fetchedAt < CSRF_TTL_MS
        ) {
            return@withLock cached
        }
        val base = baseURL()
        val request = Request.Builder()
            .url("$base/")
            .header("User-Agent", USER_AGENT)
            .build()
        ProviderDebugLogger.log("AnimeUnityClient.csrf: GET $base/")
        val html = withContext(Dispatchers.IO) {
            try {
                activeClient.newCall(request).execute().use { res ->
                    if (!res.isSuccessful) {
                        ProviderDebugLogger.logError("AnimeUnityClient.csrf: HTTP ${res.code}")
                        throw AUError.Network
                    }
                    res.body?.string() ?: throw AUError.Network
                }
            } catch (e: AUError) {
                throw e
            } catch (e: Exception) {
                ProviderDebugLogger.logError("AnimeUnityClient.csrf: exception", e)
                throw AUError.Network
            }
        }
        val token = ProviderClient.firstMatch(
            html,
            """<meta name="csrf-token" content="([^"]+)""""
        ) ?: throw AUError.NotAuthenticated
        csrfToken = token
        csrfFetchedAt = System.currentTimeMillis()
        return@withLock token
    }

    /**
     * Best-effort bootstrap del cookie `animeunity_session` per i GET (info_api,
     * embed-url) che non passano da [post]. Riusa il token cached; gli errori sono
     * ingoiati perché il GET può comunque riuscire e gestisce i propri fallimenti.
     */
    private suspend fun ensureSession() {
        runCatching { csrf() }
    }

    @Volatile private var csrfToken: String? = null
    @Volatile private var csrfFetchedAt: Long? = null

    // endregion

    // region HTTP

    @Volatile
    private var cachedBaseURL: String? = null

    private suspend fun baseURL(): String {
        cachedBaseURL?.let { return it }
        val url = settings.animeUnityBaseUrl.first().trimEnd('/')
        cachedBaseURL = url
        return url
    }

    /** Force a re-read of the configured base URL (after the user changes it). */
    fun invalidateBaseURL() { cachedBaseURL = null }

    private suspend fun postForm(path: String, form: Map<String, String>): String {
        val body = form.entries.joinToString("&") { (k, v) ->
            "${URLEncoder.encode(k, "UTF-8")}=${URLEncoder.encode(v, "UTF-8")}"
        }
        return post(path, body, FORM_CONTENT_TYPE)
    }

    private suspend fun postJSON(path: String, body: Map<String, Any?>): String {
        val json = gson.toJson(body)
        return post(path, json, JSON_CONTENT_TYPE)
    }

    /** POST with CSRF. Retries once after re-bootstrapping the token on a 419
     *  (Laravel "page expired"). */
    private suspend fun post(path: String, body: String, contentType: String): String {
        suspend fun attempt(): Pair<String, Int> {
            val token = csrf()
            val base = baseURL()
            val request = Request.Builder()
                .url("$base$path")
                .post(body.toRequestBody(contentType.toMediaType()))
                .header("Content-Type", contentType)
                .header("X-CSRF-TOKEN", token)
                .header("X-Requested-With", "XMLHttpRequest")
                .header("User-Agent", USER_AGENT)
                .header("Referer", "$base/")
                .build()
            ProviderDebugLogger.log("AnimeUnityClient.post: POST $base$path")
            return withContext(Dispatchers.IO) {
                activeClient.newCall(request).execute().use { res ->
                    (res.body?.string() ?: "") to res.code
                }
            }
        }

        val (data, status) = attempt()
        if (status == 419 || status == 401) {
            ProviderDebugLogger.log("AnimeUnityClient.post: $status → re-bootstrap CSRF")
            csrfToken = null
            csrfFetchedAt = null
            val (retryData, retryStatus) = attempt()
            if (retryStatus !in 200..299) throw AUError.NotAuthenticated
            return retryData
        }
        if (status !in 200..299) {
            ProviderDebugLogger.logError("AnimeUnityClient.post: HTTP $status")
            throw AUError.Network
        }
        return data
    }

    private suspend fun get(url: String, xhr: Boolean): String? = withContext(Dispatchers.IO) {
        try {
            val builder = Request.Builder()
                .url(url)
                .header("Accept", "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8")
                .header("User-Agent", USER_AGENT)
            if (xhr) builder.header("X-Requested-With", "XMLHttpRequest")
            val response = activeClient.newCall(builder.build()).execute()
            response.use {
                if (!it.isSuccessful) {
                    ProviderDebugLogger.logError("AnimeUnityClient.get: HTTP ${it.code} for $url")
                    return@withContext null
                }
                it.body?.string()
            }
        } catch (e: Exception) {
            ProviderDebugLogger.logError("AnimeUnityClient.get: exception for $url", e)
            null
        }
    }

    private fun parseRecords(data: String): List<AUAnime> = try {
        gson.fromJson(data, AURecordsResponse::class.java)?.records ?: emptyList()
    } catch (_: Exception) {
        emptyList()
    }

    // endregion

    companion object {
        const val EPISODE_CHUNK = 120
        const val DEFAULT_ORDER = "Più visti"

        private const val CSRF_TTL_MS = 20 * 60 * 1000L
        private const val FORM_CONTENT_TYPE = "application/x-www-form-urlencoded; charset=UTF-8"
        private const val JSON_CONTENT_TYPE = "application/json;charset=UTF-8"
        private const val USER_AGENT =
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
                "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    }
}