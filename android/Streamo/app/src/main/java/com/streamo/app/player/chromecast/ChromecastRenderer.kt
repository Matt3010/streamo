package com.streamo.app.player.chromecast

/**
 * Dispositivo Chromecast individuato da MediaRouter. Parallelo a [com.streamo.app.player.dlna.DlnaRenderer]
 * e [com.streamo.app.player.lancast.LanRenderer].
 *
 * @param friendlyName nome del dispositivo (es. "Soggiorno")
 * @param routeId id del MediaRouter route, usato per selezionarlo e avviare la sessione Cast
 * @param ip indirizzo IPv4 del Chromecast (da [com.google.android.gms.cast.CastDevice.getInetAddress]),
 *        usato per raggrupparlo per IP con DLNA/Obsidian nella stessa [com.streamo.app.ui.player.cast.CastDeviceGroup].
 *        Null se non ricavabile (diventa un gruppo a sé stante).
 */
data class ChromecastRenderer(
    val friendlyName: String,
    val routeId: String,
    val ip: String?
)