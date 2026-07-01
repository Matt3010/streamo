package com.streamo.app.ui.player.cast

import com.streamo.app.player.chromecast.ChromecastRenderer
import com.streamo.app.player.dlna.DlnaRenderer
import com.streamo.app.player.lancast.LanRenderer

/**
 * Dispositivo raggruppato per IP: stesso IP = stesso dispositivo fisico,
 * che può esporre DLNA (SSDP), Obsidian (NSD) e/o Chromecast (Google Cast).
 */
data class CastDeviceGroup(
    val ip: String,
    val name: String,
    val dlnaRenderer: DlnaRenderer?,
    val lanRenderer: LanRenderer?,
    val chromecastRenderer: ChromecastRenderer? = null
) {
    /** Key per il salvataggio preferenze: "ip|name". */
    val key: String get() = "$ip|$name"

    /** True se il dispositivo supporta più di un protocollo (apre il pannello-dettaglio). */
    val multipleProtocols: Boolean get() = availableProtocols.size > 1

    /** Protocolli disponibili per questo dispositivo, in ordine di priorità:
     *  Obsidian (raccomandato) → Chromecast → DLNA. */
    val availableProtocols: List<String> get() = buildList {
        if (lanRenderer != null) add(PROTO_STREAMO)
        if (chromecastRenderer != null) add(PROTO_CHROMECAST)
        if (dlnaRenderer != null) add(PROTO_DLNA)
    }

    companion object {
        const val PROTO_STREAMO = "streamo"
        const val PROTO_DLNA = "dlna"
        const val PROTO_CHROMECAST = "chromecast"
    }
}
