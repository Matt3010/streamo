package com.streamo.app.provider

import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Fetches skip-intro / skip-credits timestamps from TheIntroDB (v3 API).
 *
 * Keyed by TMDB id — exactly what the player already carries, so no id
 * conversion is needed. Reads are keyless (an API key only raises the rate
 * limit); a missing/failed lookup returns null so the player simply shows no
 * skip button and nothing regresses.
 *
 * Offline playback is intentionally out of scope: the caller (PlayerViewModel)
 * only queries this client for online TMDB sources.
 *
 * Android port of iOS IntroSkipClient.swift.
 */
@Singleton
class IntroSkipClient @Inject constructor(
    private val client: OkHttpClient
) {

    /** Segment boundaries in milliseconds. */
    data class Segments(
        val introStartMs: Long? = null,
        val introEndMs: Long? = null,
        val creditsStartMs: Long? = null
    ) {
        val isEmpty: Boolean get() = introEndMs == null && creditsStartMs == null
    }

    private val gson = Gson()

    /** Look up segments for a movie or TV episode. */
    suspend fun fetch(
        tmdbId: Int,
        isMovie: Boolean,
        season: Int,
        episode: Int,
        durationMs: Long?
    ): Segments? = withContext(Dispatchers.IO) {
        if (tmdbId <= 0) return@withContext null

        val urlBuilder = StringBuilder("https://api.theintrodb.org/v3/media?tmdb_id=$tmdbId")
        if (!isMovie) {
            urlBuilder.append("&season=$season&episode=$episode")
        }
        if (durationMs != null && durationMs > 0) {
            urlBuilder.append("&duration_ms=$durationMs")
        }

        val request = Request.Builder()
            .url(urlBuilder.toString())
            .header("User-Agent", "Streamo/1.0")
            .header("Accept", "application/json")
            .build()

        val response = try {
            client.newCall(request).apply {
                timeout().timeout(8, TimeUnit.SECONDS)
            }.execute()
        } catch (_: Exception) {
            return@withContext null
        }

        if (!response.isSuccessful) {
            response.close()
            return@withContext null
        }

        val body = try {
            response.body?.string()
        } catch (_: Exception) {
            null
        } finally {
            response.close()
        }

        if (body.isNullOrBlank()) return@withContext null

        val decoded = try {
            gson.fromJson(body, MediaResponse::class.java)
        } catch (_: Exception) {
            null
        } ?: return@withContext null

        val segments = Segments(
            introStartMs = decoded.intro?.firstOrNull()?.startMs,
            introEndMs = decoded.intro?.firstOrNull()?.endMs,
            creditsStartMs = decoded.credits?.firstOrNull()?.startMs
        )
        if (segments.isEmpty) null else segments
    }

    private data class MediaResponse(
        val intro: List<Segment>?,
        val credits: List<Segment>?
    ) {
        data class Segment(
            @SerializedName("start_ms") val startMs: Long?,
            @SerializedName("end_ms") val endMs: Long?
        )
    }
}
