package com.streamo.app.provider

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.URLDecoder
import java.net.URLEncoder
import com.streamo.app.util.TVLogic
import java.text.Normalizer
import com.streamo.app.data.preferences.SettingsDataStore
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Scrapes StreamingCommunity to map a TMDB title to a playable vixcloud embed
 * URL. Port of iOS ProviderClient.swift.
 *
 * The full pipeline is:
 *   1. Resolve the base URL from telegra.ph (with 10-min TTL)
 *   2. Search StreamingCommunity for the title
 *   3. Score candidates with tokenOverlapScore
 *   4. For TV: fetch the season page to get episode IDs
 *   5. Fetch the iframe page to extract the vixcloud embed URL
 */
@Singleton
class ProviderClient @Inject constructor(
    private val client: OkHttpClient,
    private val settings: SettingsDataStore
) {
    /**
     * HTTP client used for every request. Swapped to a WARP-proxied client by
     * [com.streamo.app.provider.ProviderResolver.prepareWARP] when IP-masking is
     * on, and reset to the direct [client] otherwise. Mirrors iOS `setSession`.
     */
    @Volatile
    private var activeClient: OkHttpClient = client

    fun setClient(c: OkHttpClient) { activeClient = c }
    fun resetClient() { activeClient = client }

    companion object {
        private const val LINK_SOURCE_URL =
            "https://api.telegra.ph/getPage/Link-Aggiornato-StreamingCommunity-09-29?return_content=true"
        private const val REQUEST_TIMEOUT_MS = 8000L
        // ponytail: realistic desktop Chrome UA — bare "Mozilla/5.0" is a bot fingerprint; upgrade to a full browser string.
        private const val USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/126.0.0.0 Safari/537.36"

        const val STRONG_MATCH_THRESHOLD = 170
        const val MIN_CANDIDATE_SCORE = 40
        const val MAX_STORED_CANDIDATES = 10

        private val GSON = ProviderGson.instance

        // region Scoring

        fun score(candidate: ProviderSearchTitle, wantedTitle: String, wantedYear: Int?): Int {
            val candTitle = candidate.name?.trim()
            if (candTitle.isNullOrEmpty()) return 0
            val wantedNorm = normalizeTitle(wantedTitle)
            val candNorm = normalizeTitle(candTitle)
            if (wantedNorm.isEmpty() || candNorm.isEmpty()) return 0

            var s = tokenOverlapScore(wantedNorm, candNorm)
            when {
                candNorm == wantedNorm -> s += 120
                candNorm.startsWith(wantedNorm) || wantedNorm.startsWith(candNorm) -> s += 70
                candNorm.contains(wantedNorm) || wantedNorm.contains(candNorm) -> s += 35
            }

            val candYear = extractYear(releaseDate(candidate))
            if (wantedYear != null && candYear != null) {
                when {
                    candYear == wantedYear -> s += 35
                    kotlin.math.abs(candYear - wantedYear) == 1 -> s += 10
                    else -> s -= 20
                }
            }
            return s
        }

        fun tokenOverlapScore(a: String, b: String): Int {
            val aTokens = a.split(" ").toSet()
            val bTokens = b.split(" ").toSet()
            if (aTokens.isEmpty() || bTokens.isEmpty()) return 0
            val overlap = aTokens.intersect(bTokens).size
            val total = maxOf(aTokens.size, bTokens.size)
            return Math.round((overlap.toDouble() / total) * 100).toInt()
        }

        fun normalizeTitle(value: String): String {
            val folded = Normalizer
                .normalize(value, Normalizer.Form.NFD)
                .replace(Regex("\\p{M}"), "") // strip diacritics
                .lowercase()
            val cleaned = folded.map { if (it.isLetterOrDigit()) it else ' ' }
            return cleaned.joinToString("").split(" ").filter { it.isNotEmpty() }.joinToString(" ")
        }

        fun normalizeType(value: String?): String? = when (value) {
            "movie" -> "movie"
            "tv" -> "tv"
            else -> null
        }

        fun releaseDate(title: ProviderSearchTitle): String? {
            val translation = title.translations?.firstOrNull {
                it.key == "release_date" || it.key == "last_air_date"
            }
            return translation?.value ?: title.lastAirDate
        }

        fun extractYear(value: String?): Int? {
            if (value == null) return null
            val match = Regex("""\b(\d{4})\b""").find(value) ?: return null
            return match.groupValues[1].toIntOrNull()
        }

        // endregion

        // region HTML helpers

        fun decodeHTMLEntities(value: String): String {
            var s = value
            val replacements = listOf(
                "&quot;" to "\"", "&#34;" to "\"",
                "&apos;" to "'", "&#039;" to "'", "&#39;" to "'",
                "&lt;" to "<", "&gt;" to ">",
                "&amp;" to "&"
            )
            for ((from, to) in replacements) { s = s.replace(from, to) }
            return s
        }

        fun firstMatch(text: String, pattern: String): String? {
            val regex = Regex(pattern, RegexOption.IGNORE_CASE)
            val match = regex.find(text) ?: return null
            return if (match.groupValues.size > 1) match.groupValues[1] else null
        }

        // endregion
    }

    // region Base URL (telegra.ph)

    private var cachedBaseURL: String? = null
    private var baseURLFetchedAt: Long? = null
    private val baseURLTTLMs = 10 * 60 * 1000L // 10 minutes

    suspend fun baseURL(): String? {
        val cached = cachedBaseURL
        val fetchedAt = baseURLFetchedAt
        if (cached != null && fetchedAt != null) {
            if (System.currentTimeMillis() - fetchedAt < baseURLTTLMs) {
                ProviderDebugLogger.log("baseURL: returning cached=$cached")
                return cached
            }
        }
        ProviderDebugLogger.log("baseURL: fetching fresh URL...")
        val fresh = fetchBaseURL()
        if (fresh != null) {
            ProviderDebugLogger.log("baseURL: fetched fresh=$fresh")
            cachedBaseURL = fresh
            baseURLFetchedAt = System.currentTimeMillis()
            return fresh
        }
        ProviderDebugLogger.log("baseURL: fetch failed, falling back to cached=$cached")
        // Fall back to stale cache on transient failure
        return cached
    }

    /** Force a re-fetch of the catalog base URL. */
    fun invalidateBaseURL() {
        cachedBaseURL = null
        baseURLFetchedAt = null
    }

    private suspend fun fetchBaseURL(): String? = withContext(Dispatchers.IO) {
        try {
            ProviderDebugLogger.log("fetchBaseURL: requesting $LINK_SOURCE_URL")
            val request = Request.Builder()
                .url(LINK_SOURCE_URL)
                .header("Accept", "application/json")
                .header("User-Agent", USER_AGENT)
                .build()
            val response = activeClient.newCall(request).execute()
            if (!response.isSuccessful) {
                ProviderDebugLogger.logError("fetchBaseURL: HTTP ${response.code}")
                return@withContext null
            }
            val body = response.body?.string() ?: return@withContext null

            val telegraph = GSON.fromJson(body, TelegraphResponse::class.java)
            val nodes = telegraph.result?.content
            if (nodes == null) {
                ProviderDebugLogger.logError("fetchBaseURL: no content in telegraph response")
                return@withContext null
            }
            val href = firstHref(nodes)
            if (href == null) {
                ProviderDebugLogger.logError("fetchBaseURL: no href found in nodes")
                return@withContext null
            }
            ProviderDebugLogger.log("fetchBaseURL: found href=$href")
            normalizeBaseURL(href)
        } catch (e: Exception) {
            ProviderDebugLogger.logError("fetchBaseURL: exception", e)
            null
        }
    }

    private fun firstHref(nodes: List<TelegraphNode>): String? {
        for (node in nodes) {
            val h = hrefIn(node)
            if (h != null) return h
        }
        return null
    }

    private fun hrefIn(node: TelegraphNode): String? {
        val h = node.attrs?.href?.trim()
        if (!h.isNullOrEmpty()) return h
        node.children?.forEach { child ->
            when (child) {
                is TelegraphChild.Node -> {
                    val found = hrefIn(child.node)
                    if (found != null) return found
                }
                is TelegraphChild.Text -> { /* no href in text */ }
            }
        }
        return null
    }

    private fun normalizeBaseURL(href: String): String? {
        // Remove trailing slash
        return try {
            var s = href.trim()
            if (s.endsWith("/")) s = s.dropLast(1)
            val url = java.net.URL(s)
            if (url.protocol == null || url.host == null) null else s
        } catch (_: Exception) {
            null
        }
    }

    // endregion

    // region Locale

    private suspend fun locale(): String = settings.providerLocale.first()

    // endregion

    // region Title resolution

    suspend fun resolveTitle(
        tmdbId: Int,
        mediaType: String,
        title: String,
        releaseDate: String?
    ): ProviderResolveTitleOutcome {
        ProviderDebugLogger.log("resolveTitle: tmdbId=$tmdbId type=$mediaType title='$title' releaseDate=$releaseDate")
        val query = title.trim()
        if (query.isEmpty()) {
            ProviderDebugLogger.log("resolveTitle: empty query")
            return ProviderResolveTitleOutcome(
                resolved = null,
                reason = ProviderResolveFailureReason.NOT_FOUND,
                candidates = emptyList(),
                matchStatus = ProviderMatchStatus.FAILED
            )
        }

        // Don't search for unreleased titles
        if (TVLogic.isFutureDate(releaseDate)) {
            ProviderDebugLogger.log("resolveTitle: future date ($releaseDate) → unreleased")
            return ProviderResolveTitleOutcome(
                resolved = null,
                reason = ProviderResolveFailureReason.UNRELEASED,
                candidates = emptyList(),
                matchStatus = ProviderMatchStatus.FAILED
            )
        }

        val titles = search(query)
        if (titles == null) {
            ProviderDebugLogger.log("resolveTitle: search returned null → temporarily unavailable")
            return ProviderResolveTitleOutcome(
                resolved = null,
                reason = ProviderResolveFailureReason.TEMPORARILY_UNAVAILABLE,
                candidates = emptyList(),
                matchStatus = null
            )
        }
        ProviderDebugLogger.log("resolveTitle: search returned ${titles.size} raw titles")

        val wantedYear = extractYear(releaseDate)
        ProviderDebugLogger.log("resolveTitle: wantedYear=$wantedYear")
        val ranked = titles
            .filter { it.id != null && normalizeType(it.type) == mediaType }
            .map { Pair(it, score(it, query, wantedYear)) }
            .sortedByDescending { it.second }

        ProviderDebugLogger.log("resolveTitle: ${ranked.size} candidates after type filter")
        ranked.take(5).forEachIndexed { i, (t, s) ->
            ProviderDebugLogger.log("  #${i+1} score=$s id=${t.id} name='${t.name}' type=${t.type}")
        }

        val candidates = ranked
            .filter { it.second >= MIN_CANDIDATE_SCORE }
            .take(MAX_STORED_CANDIDATES)
            .map { (t, s) ->
                ProviderCandidate(
                    providerTitleId = t.id!!,
                    providerSlug = t.slug,
                    title = t.name?.trim() ?: query,
                    year = extractYear(releaseDate(t)),
                    score = s
                )
            }

        val best = ranked.firstOrNull()
        if (best == null || best.second < MIN_CANDIDATE_SCORE || best.first.id == null) {
            ProviderDebugLogger.log("resolveTitle: no good match (best=${best?.second}, min=$MIN_CANDIDATE_SCORE)")
            return ProviderResolveTitleOutcome(
                resolved = null,
                reason = ProviderResolveFailureReason.NOT_FOUND,
                candidates = candidates,
                matchStatus = ProviderMatchStatus.FAILED
            )
        }

        if (best.second >= STRONG_MATCH_THRESHOLD) {
            val resolved = ProviderResolvedTitle(
                id = best.first.id!!,
                slug = best.first.slug,
                title = best.first.name?.trim() ?: query,
                mediaType = mediaType
            )
            ProviderDebugLogger.log("resolveTitle: strong match id=${resolved.id} slug=${resolved.slug} score=${best.second}")
            return ProviderResolveTitleOutcome(
                resolved = resolved,
                reason = null,
                candidates = candidates,
                matchStatus = ProviderMatchStatus.AUTO_CONFIRMED
            )
        }

        // Weak match: keep candidates for the picker, but don't auto-confirm
        ProviderDebugLogger.log("resolveTitle: weak match (score=${best.second} < $STRONG_MATCH_THRESHOLD), needs picker")
        return ProviderResolveTitleOutcome(
            resolved = null,
            reason = ProviderResolveFailureReason.NOT_FOUND,
            candidates = candidates,
            matchStatus = ProviderMatchStatus.FAILED
        )
    }

    // endregion

    // region Search

    private suspend fun search(query: String): List<ProviderSearchTitle>? {
        val base = baseURL() ?: return null
        val encoded = URLEncoder.encode(query, "UTF-8")
        val url = "$base/${locale()}/search?q=$encoded"
        ProviderDebugLogger.log("search: GET $url")
        val (data, contentType) = get(url) ?: return null
        ProviderDebugLogger.log("search: response contentType=$contentType length=${data.length}")

        val page: ProviderSearchPage?
        if (contentType?.contains("application/json") == true) {
            ProviderDebugLogger.log("search: parsing as JSON")
            page = parseSearchPageFromJson(data)
        } else {
            ProviderDebugLogger.log("search: parsing as Inertia HTML")
            page = parseInertiaPage(data, ProviderSearchPage::class.java)
        }
        val titles = page?.props?.titles?.titles
        ProviderDebugLogger.log("search: extracted ${titles?.size ?: 0} titles")
        return titles
    }

    // endregion

    // region Episode / Movie embed

    suspend fun episodeEmbed(providerTitleId: Int, slug: String?, season: Int, episode: Int): ProviderEmbedOutcome {
        ProviderDebugLogger.log("episodeEmbed: providerTitleId=$providerTitleId slug=$slug season=$season episode=$episode")
        val loaded = fetchSeason(providerTitleId, slug, season)
        if (loaded == null) {
            ProviderDebugLogger.log("episodeEmbed: fetchSeason returned null")
            return ProviderEmbedOutcome(embedUrl = null, reason = ProviderResolveFailureReason.TEMPORARILY_UNAVAILABLE)
        }
        val episodes = loaded.episodes ?: emptyList()
        if (episodes.isEmpty()) {
            ProviderDebugLogger.log("episodeEmbed: season has no episodes")
            return ProviderEmbedOutcome(embedUrl = null, reason = ProviderResolveFailureReason.TEMPORARILY_UNAVAILABLE)
        }
        val match = episodes.firstOrNull { it.number == episode && it.id != null }
        if (match == null) {
            ProviderDebugLogger.log("episodeEmbed: episode $episode not found in season (got ${episodes.map { it.number }})")
            return ProviderEmbedOutcome(embedUrl = null, reason = ProviderResolveFailureReason.NOT_FOUND)
        }
        ProviderDebugLogger.log("episodeEmbed: matched episode id=${match.id}")
        val embed = fetchEmbedURL(providerTitleId, match.id)
            ?: return ProviderEmbedOutcome(embedUrl = null, reason = ProviderResolveFailureReason.TEMPORARILY_UNAVAILABLE).also {
                ProviderDebugLogger.log("episodeEmbed: fetchEmbedURL returned null")
            }
        ProviderDebugLogger.log("episodeEmbed: embed URL=$embed")
        return ProviderEmbedOutcome(embedUrl = embed, reason = null)
    }

    suspend fun movieEmbed(providerTitleId: Int): ProviderEmbedOutcome {
        ProviderDebugLogger.log("movieEmbed: providerTitleId=$providerTitleId")
        val embed = fetchEmbedURL(providerTitleId, null)
            ?: return ProviderEmbedOutcome(embedUrl = null, reason = ProviderResolveFailureReason.TEMPORARILY_UNAVAILABLE).also {
                ProviderDebugLogger.log("movieEmbed: fetchEmbedURL returned null")
            }
        ProviderDebugLogger.log("movieEmbed: embed URL=$embed")
        return ProviderEmbedOutcome(embedUrl = embed, reason = null)
    }

    // endregion

    // region Network primitives

    private suspend fun fetchSeason(providerTitleId: Int, slug: String?, seasonNumber: Int): ProviderLoadedSeason? {
        val base = baseURL() ?: return null
        val resolvedSlug = slug?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val url = "$base/${locale()}/titles/$providerTitleId-$resolvedSlug/season-$seasonNumber"
        ProviderDebugLogger.log("fetchSeason: GET $url")
        val (data, contentType) = get(url) ?: return null

        val page: ProviderTitlePage?
        if (contentType?.contains("application/json") == true) {
            page = GSON.fromJson(data, ProviderTitlePage::class.java)
        } else {
            page = parseInertiaPage(data, ProviderTitlePage::class.java)
        }
        val season = page?.props?.loadedSeason
        ProviderDebugLogger.log("fetchSeason: loaded season number=${season?.number} episodes=${season?.episodes?.size}")
        return season
    }

    /**
     * Fetch the iframe page and extract the absolute vixcloud embed URL.
     */
    private suspend fun fetchEmbedURL(providerTitleId: Int, episodeId: Int?): String? {
        val base = baseURL() ?: return null
        val url = buildString {
            append(base)
            append("/")
            append(locale())
            append("/iframe/")
            append(providerTitleId)
            if (episodeId != null) {
                append("?episode_id=")
                append(episodeId)
                append("&next_episode=1")
            }
        }
        ProviderDebugLogger.log("fetchEmbedURL: GET $url")
        val (data, _) = get(url) ?: return null
        val html = data

        // Extract iframe src
        val raw = firstMatch(html, """<iframe[^>]+src="([^"]+)"""")
            ?: firstMatch(html, """<iframe[^>]+src='([^']+)'""")
            ?: return null

        val embed = decodeHTMLEntities(raw.trim())
        ProviderDebugLogger.log("fetchEmbedURL: raw iframe src=$embed")

        // Validate that it's a vixcloud embed
        return try {
            val urlObj = java.net.URL(embed)
            if (urlObj.host == "vixcloud.co" && urlObj.path.startsWith("/embed/")) {
                embed
            } else {
                ProviderDebugLogger.log("fetchEmbedURL: rejected embed host=${urlObj.host} path=${urlObj.path}")
                null
            }
        } catch (_: Exception) {
            ProviderDebugLogger.log("fetchEmbedURL: failed to parse embed URL")
            null
        }
    }

    private data class HttpResponse(val body: String, val contentType: String?)

    private suspend fun get(url: String, accept: String = "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8"): HttpResponse? =
        withContext(Dispatchers.IO) {
            try {
                val request = Request.Builder()
                    .url(url)
                    .header("Accept", accept)
                    .header("Referer", "") // no-referrer like the web
                    .header("User-Agent", USER_AGENT)
                    .build()
                ProviderDebugLogger.log("HTTP GET $url")
                val response = activeClient.newCall(request).execute()
                if (!response.isSuccessful) {
                    ProviderDebugLogger.logError("HTTP GET failed: ${response.code} for $url")
                    return@withContext null
                }
                val body = response.body?.string() ?: return@withContext null
                val contentType = response.header("content-type")
                ProviderDebugLogger.log("HTTP GET success: $url (body=${body.length} chars)")
                HttpResponse(body, contentType)
            } catch (e: Exception) {
                ProviderDebugLogger.logError("HTTP GET exception for $url", e)
                null
            }
        }

    // endregion

    // region Inertia page parsing

    /**
     * Extract and decode the Inertia `data-page="..."` JSON blob from an HTML page.
     */
    private fun <T> parseInertiaPage(html: String, clazz: Class<T>): T? {
        val marker = "data-page="
        val markerRange = html.indexOf(marker)
        if (markerRange < 0) return null
        val after = html.substring(markerRange + marker.length)
        if (after.isEmpty()) return null

        val quote = after[0]
        if (quote != '"' && quote != '\'') return null

        var value = StringBuilder()
        var i = 1
        while (i < after.length && after[i] != quote) {
            value.append(after[i])
            i++
        }
        if (value.isEmpty()) return null

        val json = decodeHTMLEntities(value.toString())
        return try {
            GSON.fromJson(json, clazz)
        } catch (_: Exception) {
            null
        }
    }

    private fun parseSearchPageFromJson(json: String): ProviderSearchPage? {
        return try {
            GSON.fromJson(json, ProviderSearchPage::class.java)
        } catch (_: Exception) {
            null
        }
    }

    // endregion

}