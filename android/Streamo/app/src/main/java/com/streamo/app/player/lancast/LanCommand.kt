package com.streamo.app.player.lancast

/** Comandi di cast ricevuti dal telefono via HTTP. */
sealed class LanCommand {
    data class Play(
        val tmdbId: Int,
        val mediaType: String,
        val season: Int,
        val episode: Int,
        val title: String,
        val posterUrl: String?,
        val releaseDate: String?,
        val startPositionMs: Long
    ) : LanCommand()

    data object Pause : LanCommand()
    data object Resume : LanCommand()
    data object Stop : LanCommand()
    data class Seek(val positionMs: Long) : LanCommand()
}
