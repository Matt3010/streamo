package com.streamo.app.player.streamo

/** Stato riportato dal server Streamo sulla TV (GET /status). */
data class StreamoStatus(
    val status: String,       // "playing" | "paused" | "stopped" | "loading" | "error"
    val positionMs: Long,
    val durationMs: Long,
    val title: String?,
    val tmdbId: Int?,
    val mediaType: String?
)
