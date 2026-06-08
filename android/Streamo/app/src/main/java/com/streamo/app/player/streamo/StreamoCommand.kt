package com.streamo.app.player.streamo

/** Comandi di cast ricevuti dal telefono via HTTP. */
sealed class StreamoCommand {
    data class Play(
        val tmdbId: Int,
        val mediaType: String,
        val season: Int,
        val episode: Int,
        val title: String,
        val posterUrl: String?,
        val releaseDate: String?,
        val startPositionMs: Long
    ) : StreamoCommand()

    data object Pause : StreamoCommand()
    data object Resume : StreamoCommand()
    data object Stop : StreamoCommand()
    data class Seek(val positionMs: Long) : StreamoCommand()
}
