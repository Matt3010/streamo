package com.streamo.app.ui.player.cast

import com.streamo.app.player.dlna.DlnaRenderer
import com.streamo.app.player.streamo.StreamoRenderer

/**
 * Dispositivo raggruppato per IP: stesso IP = stesso dispositivo fisico,
 * che può esporre sia DLNA (SSDP) che Streamo (NSD).
 */
data class CastDeviceGroup(
    val ip: String,
    val name: String,
    val dlnaRenderer: DlnaRenderer?,
    val streamoRenderer: StreamoRenderer?
) {
    /** Key per il salvataggio preferenze: "ip|name". */
    val key: String get() = "$ip|$name"

    /** True se il dispositivo supporta entrambi i protocolli. */
    val hasBoth: Boolean get() = dlnaRenderer != null && streamoRenderer != null

    /** Protocolli disponibili per questo dispositivo. */
    val availableProtocols: List<String> get() = buildList {
        if (streamoRenderer != null) add(PROTO_STREAMO)
        if (dlnaRenderer != null) add(PROTO_DLNA)
    }

    companion object {
        const val PROTO_STREAMO = "streamo"
        const val PROTO_DLNA = "dlna"
    }
}
