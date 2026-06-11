package com.streamo.app.player.lancast

/** Dispositivo Obsidian scoperto in rete locale (es. app TV Obsidian su Android TV / Fire TV). */
data class LanRenderer(
    val friendlyName: String,
    /** Indirizzo IP del dispositivo (es. "192.168.1.42"). */
    val host: String,
    /** Porta del server HTTP LanCastServer. */
    val port: Int
) {
    /** Key di raggruppamento: stesso IP = stesso dispositivo fisico. */
    val deviceKey: String get() = host
}
