package com.streamo.app.player.streamo

import android.util.Log
import com.google.gson.Gson
import fi.iki.elonen.NanoHTTPD
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * NanoHTTPD server sulla TV che riceve comandi di cast dal telefono.
 *
 * Tutti i POST usano form-encoded body (chiave=valore). NanoHTTPD NON popola
 * [IHTTPSession.parameters] col body finché non si chiama [IHTTPSession.parseBody]:
 * va invocato in [serve] prima di leggere i parametri, altrimenti i campi sono null.
 *
 * Endpoint:
 * - POST /play    tmdbId, mediaType, season, episode, title, posterUrl, releaseDate, startPositionMs
 * - POST /pause   (vuoto)
 * - POST /resume  (vuoto)
 * - POST /stop    (vuoto)
 * - POST /seek    positionMs
 * - GET  /status  → JSON {status, positionMs, durationMs, title?, tmdbId?, mediaType?}
 */
class StreamoCastServer(
    port: Int,
    private val emit: (StreamoCommand) -> Boolean,
    private val currentStatus: MutableStateFlow<StreamoStatus>
) : NanoHTTPD(port) {

    private val gson = Gson()

    // --- Routing ---

    override fun serve(session: IHTTPSession): Response {
        return try {
            // NanoHTTPD richiede parseBody() per popolare i parametri dal body form-encoded
            // dei POST; senza, session.parameters resta vuoto e ogni /play fallisce con 400.
            if (session.method == Method.POST || session.method == Method.PUT) {
                session.parseBody(HashMap())
            }
            val path = session.uri.trimEnd('/')
            when {
                path == "/play" && session.method == Method.POST -> handlePlay(session)
                path == "/pause" && session.method == Method.POST -> handleCommand(StreamoCommand.Pause, "paused")
                path == "/resume" && session.method == Method.POST -> handleCommand(StreamoCommand.Resume, "playing")
                path == "/stop" && session.method == Method.POST -> handleCommand(StreamoCommand.Stop, "stopped")
                path == "/seek" && session.method == Method.POST -> handleSeek(session)
                path == "/status" && session.method == Method.GET -> handleStatus()
                else -> jsonResponse(Response.Status.NOT_FOUND, mapOf("error" to "not found"))
            }
        } catch (e: Exception) {
            Log.w(TAG, "serve failed path=${session.uri}", e)
            jsonResponse(Response.Status.INTERNAL_ERROR, mapOf("error" to "internal error: ${e.message}"))
        }
    }

    private fun handlePlay(session: IHTTPSession): Response {
        val p = session.parameters
        val tmdbId = p["tmdbId"]?.firstOrNull()?.toIntOrNull()
        val mediaType = p["mediaType"]?.firstOrNull()
        if (tmdbId == null || mediaType == null) {
            return jsonResponse(Response.Status.BAD_REQUEST, mapOf("error" to "missing tmdbId or mediaType"))
        }

        val season = p["season"]?.firstOrNull()?.toIntOrNull() ?: 0
        val episode = p["episode"]?.firstOrNull()?.toIntOrNull() ?: 0
        val title = p["title"]?.firstOrNull() ?: ""
        val posterUrl = p["posterUrl"]?.firstOrNull()
        val releaseDate = p["releaseDate"]?.firstOrNull()
        val startPositionMs = p["startPositionMs"]?.firstOrNull()?.toLongOrNull() ?: 0L

        val interrupted = currentStatus.value.status.let { it == "playing" || it == "paused" }

        val sent = emit(
            StreamoCommand.Play(
                tmdbId = tmdbId, mediaType = mediaType, season = season,
                episode = episode, title = title, posterUrl = posterUrl,
                releaseDate = releaseDate, startPositionMs = startPositionMs
            )
        )
        if (!sent) {
            return jsonResponse(Response.Status.SERVICE_UNAVAILABLE, mapOf("error" to "player busy"))
        }

        // Sempre 200: il comando è stato accettato. interrupted è solo informativo —
        // restituire 409 faceva fallire il client (post() tratta non-2xx come errore)
        // mostrando un falso "TV non raggiungibile" al secondo cast.
        Log.d(TAG, "play tmdbId=$tmdbId type=$mediaType interrupted=$interrupted")
        return jsonResponse(Response.Status.OK, mapOf("status" to "playing", "interrupted" to interrupted))
    }

    private fun handleCommand(cmd: StreamoCommand, statusLabel: String): Response {
        val sent = emit(cmd)
        if (!sent) {
            return jsonResponse(Response.Status.SERVICE_UNAVAILABLE, mapOf("error" to "player busy"))
        }
        return jsonResponse(Response.Status.OK, mapOf("status" to statusLabel))
    }

    private fun handleSeek(session: IHTTPSession): Response {
        val posMs = session.parameters["positionMs"]?.firstOrNull()?.toLongOrNull()
            ?: return jsonResponse(Response.Status.BAD_REQUEST, mapOf("error" to "missing positionMs"))
        val sent = emit(StreamoCommand.Seek(posMs))
        if (!sent) {
            return jsonResponse(Response.Status.SERVICE_UNAVAILABLE, mapOf("error" to "player busy"))
        }
        return jsonResponse(Response.Status.OK, mapOf("status" to "ok", "positionMs" to posMs))
    }

    private fun handleStatus(): Response {
        val s = currentStatus.value
        return jsonResponse(Response.Status.OK, mapOf(
            "status" to s.status,
            "positionMs" to s.positionMs,
            "durationMs" to s.durationMs,
            "title" to s.title,
            "tmdbId" to s.tmdbId,
            "mediaType" to s.mediaType
        ))
    }

    private fun jsonResponse(status: Response.Status, data: Any): Response {
        val json = gson.toJson(data)
        return newFixedLengthResponse(status, "application/json", json)
    }

    companion object {
        private const val TAG = "StreamoCastServer"
    }
}
