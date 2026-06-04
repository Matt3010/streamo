package com.streamo.app.player

import android.content.Intent
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

@UnstableApi
class PlaybackService : MediaSessionService() {

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        syncSessions()
        return super.onStartCommand(intent, flags, startId)
    }

    /**
     * Allinea la lista di sessioni del service all'holder: registra quelle presenti
     * (locale + cast) e rimuove quelle non più referenziate. MediaSessionService mostra
     * la notifica solo per le sessioni nella sua lista.
     */
    private fun syncSessions() {
        val wanted = listOfNotNull(PlaybackSessionHolder.session, PlaybackSessionHolder.castSession)
        wanted.forEach { s ->
            if (sessions.none { it === s }) runCatching { addSession(s) }
        }
        sessions.filter { s -> wanted.none { it === s } }
            .forEach { runCatching { removeSession(it) } }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? =
        PlaybackSessionHolder.castSession ?: PlaybackSessionHolder.session

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Non fermare se c'è una trasmissione cast attiva.
        if (PlaybackSessionHolder.castSession != null) return
        val player = PlaybackSessionHolder.session?.player
        if (player == null || !player.playWhenReady || player.mediaItemCount == 0 ||
            player.playbackState == Player.STATE_ENDED
        ) {
            stopSelf()
        }
    }
}
