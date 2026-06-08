package com.streamo.app.player.streamo

import android.util.Log
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import java.net.Inet4Address
import java.net.NetworkInterface

/**
 * Bridge singleton tra il server HTTP (StreamoCastServer) e il player TV.
 *
 * Riceve comandi di cast dal telefono via [commands] (consumati da TvRootView + TvPlayerScreen)
 * ed espone lo stato della riproduzione TV via [currentStatus] (scritto da TvPlayerScreen,
 * letto dal server per rispondere a GET /status).
 *
 * Usato su dispositivi TV. Su phone non viene istanziato.
 */
object StreamoCastReceiver {

    private const val TAG = "StreamoCastReceiver"

    /**
     * Comandi in arrivo dal telefono. SharedFlow (non Channel) per il fan-out: lo
     * consumano sia il consumer globale in TvRootView (naviga al player se la TV è
     * ferma) sia TvPlayerScreen (transport quando il player è aperto).
     */
    private val _commands = MutableSharedFlow<StreamoCommand>(
        extraBufferCapacity = 16,
        onBufferOverflow = BufferOverflow.DROP_OLDEST
    )
    val commands: SharedFlow<StreamoCommand> = _commands.asSharedFlow()

    /**
     * Ultimo comando Play ricevuto, finché non viene consumato. Serve al cold-start:
     * quando il telefono casta e la UI TV non è ancora viva, il service lancia
     * MainActivity e TvRootView, appena composto, legge qui il Play e apre il player.
     */
    private val _pendingPlay = MutableStateFlow<StreamoCommand.Play?>(null)
    val pendingPlay: StateFlow<StreamoCommand.Play?> = _pendingPlay.asStateFlow()

    fun clearPendingPlay() { _pendingPlay.value = null }

    /** Emette un comando ai collector. @return false se nessun buffer disponibile. */
    fun emitCommand(cmd: StreamoCommand): Boolean {
        if (cmd is StreamoCommand.Play) _pendingPlay.value = cmd
        return _commands.tryEmit(cmd)
    }

    private val _currentStatus = MutableStateFlow(StreamoStatus(
        status = "stopped", positionMs = 0, durationMs = 0,
        title = null, tmdbId = null, mediaType = null
    ))
    /** Stato riproduzione TV (scritto da TvPlayerScreen, letto da GET /status). */
    val currentStatus: StateFlow<StreamoStatus> = _currentStatus.asStateFlow()

    private var server: StreamoCastServer? = null

    val isRunning: Boolean get() = server?.isAlive == true

    /** Porta su cui il server è in ascolto (valida dopo [start]). */
    val listeningPort: Int get() = server?.listeningPort ?: 0

    /**
     * Avvia il server HTTP e lo mette in ascolto sulla porta effimera.
     * @return true se avviato con successo.
     */
    fun start(): Boolean {
        if (server?.isAlive == true) return true
        return try {
            val s = StreamoCastServer(0, ::emitCommand, _currentStatus)
            s.start(NanoHTTPDReadTimeout, false)
            server = s
            Log.i(TAG, "server started on port ${s.listeningPort}")
            true
        } catch (e: Exception) {
            Log.w(TAG, "server start failed", e)
            false
        }
    }

    /** Ferma il server HTTP. */
    fun stop() {
        runCatching { server?.stop() }
        server = null
        Log.d(TAG, "server stopped")
    }

    /** Aggiorna lo stato della riproduzione (chiamato da TvPlayerScreen). */
    fun updateStatus(status: StreamoStatus) {
        _currentStatus.value = status
    }

    /** IPv4 dell'interfaccia WiFi attiva, per registrare NSD sull'indirizzo giusto. */
    fun wifiIpv4(): String? = runCatching {
        NetworkInterface.getNetworkInterfaces().asSequence()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.asSequence() }
            .firstOrNull { it is Inet4Address && it.isSiteLocalAddress }
            ?.hostAddress
    }.getOrNull()

    /** Timeout lettura socket NanoHTTPD: abbastanza lungo per non troncare richieste lente. */
    const val NanoHTTPDReadTimeout = 5000
}
