package com.streamo.app.player

import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession

/**
 * Ponte verso [PlaybackService] per le notifiche media. Due slot:
 * - [session]: sessione locale (ExoPlayer), creata dal PlayerViewModel.
 * - [castSession]: sessione del cast DLNA (app-scoped, [com.streamo.app.player.cast.CastController]),
 *   sopravvive alla chiusura del player così la trasmissione continua in background.
 * Il service registra entrambe; mostra la notifica per quella in riproduzione.
 */
@UnstableApi
object PlaybackSessionHolder {
    @Volatile
    var session: MediaSession? = null

    @Volatile
    var castSession: MediaSession? = null
}
