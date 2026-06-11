package com.streamo.app.player.lancast

/** Stato riportato dal server Obsidian sulla TV (GET /status). */
data class LanStatus(
    val status: String,       // "playing" | "paused" | "stopped" | "loading" | "error"
    val positionMs: Long,
    val durationMs: Long,
    val title: String?,
    val tmdbId: Int?,
    val mediaType: String?
)
