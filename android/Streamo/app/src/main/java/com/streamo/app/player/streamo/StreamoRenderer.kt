package com.streamo.app.player.streamo

/** Dispositivo Streamo scoperto in rete locale (es. app TV Streamo su Android TV / Fire TV). */
data class StreamoRenderer(
    val friendlyName: String,
    /** Indirizzo IP del dispositivo (es. "192.168.1.42"). */
    val host: String,
    /** Porta del server HTTP StreamoCastServer. */
    val port: Int
) {
    /** Key di raggruppamento: stesso IP = stesso dispositivo fisico. */
    val deviceKey: String get() = host
}
