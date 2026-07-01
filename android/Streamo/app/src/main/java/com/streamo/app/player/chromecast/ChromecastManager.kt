package com.streamo.app.player.chromecast

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.mediarouter.media.MediaRouteSelector
import androidx.mediarouter.media.MediaRouter
import com.google.android.gms.cast.CastDevice
import com.google.android.gms.cast.CastMediaControlIntent
import com.google.android.gms.cast.HlsSegmentFormat
import com.google.android.gms.cast.HlsVideoSegmentFormat
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.MediaLoadRequestData
import com.google.android.gms.cast.MediaMetadata
import com.google.android.gms.cast.MediaSeekOptions
import com.google.android.gms.common.images.WebImage
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.SessionManager
import com.google.android.gms.cast.framework.SessionManagerListener
import com.google.android.gms.cast.framework.media.RemoteMediaClient
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailabilityLight
import com.streamo.app.player.cast.CastMedia
import com.streamo.app.player.dlna.LocalHlsProxy
import com.streamo.app.tmdb.TMDBImage
import fi.iki.elonen.NanoHTTPD
import kotlinx.coroutines.Dispatchers
import okhttp3.OkHttpClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface

/**
 * Backend Cast (Google Cast SDK) per Chromecast / TV con Chromecast integrato.
 * Parallelo a [com.streamo.app.player.dlna.DlnaCastManager] e
 * [com.streamo.app.player.lancast.LanCastClient].
 *
 * A differenza di DLNA/Obsidian (discovery one-shot), Cast espone discovery continuo via
 * callback MediaRouter. Lo stream viene servito al Chromecast attraverso il proxy HLS locale
 * [LocalHlsProxy] (stesso del DLNA) così da iniettare gli header vixcloud Referer/Origin che il
 * Default Media Receiver non inoltrerebbe altrimenti.
 *
 * **Guard GMS**: l'app gira anche su Fire TV / Android TV senza Play Services. Ogni accesso al
 * Cast SDK è preceduto da un check di disponibilità; se GMS manca, discovery è vuota e tutti i
 * comandi sono no-op (mai crash).
 */
class ChromecastManager(private val appContext: Context) {

    private val _renderers = MutableStateFlow<List<ChromecastRenderer>>(emptyList())
    val renderers: StateFlow<List<ChromecastRenderer>> = _renderers.asStateFlow()

    private val _scanning = MutableStateFlow(false)
    val scanning: StateFlow<Boolean> = _scanning.asStateFlow()

    private val castContext: CastContext? by lazy { initCastContext() }
    private val mediaRouter: MediaRouter? get() = if (!isGmsAvailable) null else MediaRouter.getInstance(appContext)
    private var selector: MediaRouteSelector? = null
    private var routerCallback: MediaRouter.Callback? = null

    // --- Pending load: memorizzato prima di selectRoute, applicato in onSessionStarted ---
    private var proxy: LocalHlsProxy? = null
    private var pendingProxyUrl: String? = null
    private var pendingMedia: CastMedia? = null
    private var pendingStartPositionMs: Long = 0L
    private var sessionListener: SessionManagerListener<CastSession>? = null

    val isGmsAvailable: Boolean by lazy {
        GoogleApiAvailabilityLight.getInstance()
            .isGooglePlayServicesAvailable(appContext) == ConnectionResult.SUCCESS
    }

    private fun initCastContext(): CastContext? {
        if (!isGmsAvailable) {
            Log.d(TAG, "GMS non disponibili: Cast disabilitato")
            return null
        }
        return runCatching { CastContext.getSharedInstance(appContext) }
            .getOrElse { Log.w(TAG, "CastContext init fallito", it); null }
    }

    // --- Discovery ---

    fun startDiscovery() {
        val router = mediaRouter ?: return
        if (selector == null) {
            selector = MediaRouteSelector.Builder()
                .addControlCategory(
                    CastMediaControlIntent.categoryForCast(
                        CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID
                    )
                )
                .build()
        }
        if (routerCallback == null) routerCallback = object : MediaRouter.Callback() {
            override fun onRouteAdded(router: MediaRouter, route: MediaRouter.RouteInfo) = rebuild(router)
            override fun onRouteChanged(router: MediaRouter, route: MediaRouter.RouteInfo) = rebuild(router)
            override fun onRouteRemoved(router: MediaRouter, route: MediaRouter.RouteInfo) = rebuild(router)
        }
        _scanning.value = true
        // CALLBACK_FLAG_REQUEST_DISCOVERY chiede già una discovery attiva: i route arrivano via
        // callback. rebuild() iniziale per raccogliere quelli eventualmente già noti.
        runCatching {
            router.addCallback(selector!!, routerCallback!!, MediaRouter.CALLBACK_FLAG_REQUEST_DISCOVERY)
        }
        rebuild(router)
    }

    /**
     * Chiude solo la finestra dello spinner (allineata a quella one-shot di DLNA/Obsidian):
     * la discovery resta attiva (i route Cast continuano ad arrivare via callback), ma il
     * telefono smette di mostrare "Ricerca dispositivi…". Senza questo, [_scanning] resterebbe
     * `true` per sempre — la discovery Cast non ha un "fine" naturale.
     */
    fun endScanningWindow() {
        _scanning.value = false
    }

    fun stopDiscovery() {
        _scanning.value = false
        val router = mediaRouter ?: return
        routerCallback?.let { runCatching { router.removeCallback(it) } }
    }

    private fun rebuild(router: MediaRouter) {
        val sel = selector ?: return
        val list = router.routes
            .filter { it.matchesSelector(sel) }
            .mapNotNull { route ->
                val device = CastDevice.getFromBundle(route.extras) ?: return@mapNotNull null
                ChromecastRenderer(
                    friendlyName = device.friendlyName ?: route.name,
                    routeId = route.id,
                    ip = device.inetAddress?.hostAddress
                )
            }
        _renderers.value = list
    }

    // --- Playback ---

    /**
     * Avvia il proxy HLS locale, seleziona il route Cast e carica il media via Default Media
     * Receiver. La selezione del route avvia una CastSession in autonomia; il load effettivo
     * avviene in [onSessionStarted]. Ritorna true se il proxy è partito e il route è stato
     * selezionato (ottimistico, come [com.streamo.app.player.dlna.DlnaCastManager.play]).
     */
    suspend fun play(
        renderer: ChromecastRenderer,
        streamUrl: String,
        headers: Map<String, String>,
        media: CastMedia,
        startPositionMs: Long,
        upstreamClient: OkHttpClient? = null
    ): Boolean {
        if (!isGmsAvailable) {
            Log.w(TAG, "GMS non disponibili: impossibile avviare il cast")
            return false
        }
        // Avvio del proxy HLS locale su IO (NanoHTTPD apre il socket di rete). NON toccare il
        // Cast SDK / MediaRouter qui: quelle API richiedono il main thread (vedi sotto).
        val host = wifiIpv4Address()?.hostAddress
        if (host == null) {
            Log.w(TAG, "nessun IP WiFi: impossibile avviare il proxy")
            return false
        }
        val served = withContext(Dispatchers.IO) {
            stopProxy()
            // Chromecast/Shaka fa ABR da sé: master completo (singleVariant=false), a differenza
            // della DMR DLNA che va forzata su una sola variante.
            val p = LocalHlsProxy(streamUrl, headers, host, upstreamClient, singleVariant = false)
            try {
                p.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
                proxy = p
                p.streamUrl
            } catch (e: Exception) {
                Log.w(TAG, "avvio proxy fallito", e)
                null
            }
        } ?: return false
        pendingProxyUrl = served
        pendingMedia = media
        pendingStartPositionMs = startPositionMs

        // CastContext.getSharedInstance, MediaRouter.getInstance/routes/selectRoute richiedono
        // TUTTI il main thread (Preconditions.checkMainThread): off-main lanciano
        // IllegalStateException → il cast non parte mai. Esegui l'intero handshake su Main.
        return withContext(Dispatchers.Main) {
            val ctx = castContext
            if (ctx == null) {
                Log.w(TAG, "CastContext null: Cast SDK non inizializzato, impossibile avviare il cast")
                stopProxy()
                return@withContext false
            }
            ensureSessionListener(ctx.sessionManager)
            val router = mediaRouter
            val route = router?.routes?.firstOrNull { it.id == renderer.routeId }
            if (route == null) {
                Log.w(TAG, "route non trovato per ${renderer.friendlyName}")
                stopProxy()
                return@withContext false
            }
            runCatching { router.selectRoute(route) }
            Log.d(TAG, "selectRoute ${renderer.friendlyName}, servo: $served")
            true
        }
    }

    private fun ensureSessionListener(sessionManager: SessionManager) {
        if (sessionListener != null) return
        val listener = object : SessionManagerListener<CastSession> {
            override fun onSessionStarted(session: CastSession, sessionId: String) {
                loadPending(session)
            }
            override fun onSessionResumed(session: CastSession, wasSuspended: Boolean) {
                loadPending(session)
            }
            override fun onSessionEnded(session: CastSession, error: Int) {}
            override fun onSessionStarting(session: CastSession) {}
            override fun onSessionStartFailed(session: CastSession, error: Int) {}
            override fun onSessionEnding(session: CastSession) {}
            override fun onSessionResuming(session: CastSession, sessionId: String) {}
            override fun onSessionResumeFailed(session: CastSession, error: Int) {}
            override fun onSessionSuspended(session: CastSession, reason: Int) {}
        }
        sessionListener = listener
        runCatching { sessionManager.addSessionManagerListener(listener, CastSession::class.java) }
    }

    /**
     * Carica il media sulla sessione Cast appena avviata. Eseguito UNA SOLA VOLTA per richiesta
     * di cast: il listener resta agganciato anche dopo, e `onSessionResumed` rifarebbe partire
     * questo load — ma un resume genuino (l'app torna in foreground, blip di rete) ricaricherebbe
     * lo stream e farebbe seek a [pendingStartPositionMs] (la posizione INIZIALE), perdendo il
     * progresso visto. Quindi i campi `pending*` vengono consumati e azzerati dopo il primo load;
     * un resume successivo non trova nulla da caricare e si riaggancia alla sessione esistente.
     */
    private fun loadPending(session: CastSession) {
        val url = pendingProxyUrl ?: return
        val media = pendingMedia ?: return
        val rmc = session.remoteMediaClient ?: return
        val metadata = MediaMetadata(MediaMetadata.MEDIA_TYPE_MOVIE).apply {
            putString(MediaMetadata.KEY_TITLE, media.displayTitle)
            media.poster?.let {
                val posterUrl = TMDBImage.url(it, TMDBImage.Size.W500)
                addImage(WebImage(Uri.parse(posterUrl)))
            }
        }
        val info = MediaInfo.Builder(url)
            .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
            .setContentType("application/x-mpegurl")
            // Lo stream vixcloud è HLS DEMUXATO in MPEG-TS (video .ts + audio .ts separati). Il
            // Default Media Receiver (Shaka) di default assume "packed audio" e sbaglia il parse al
            // primo cambio variante/rotazione chiave → "Invalid Request" + idleReason=4. Questi hint
            // dicono al receiver che video e audio sono entrambi MPEG-TS, così li demuxa correttamente.
            .setHlsVideoSegmentFormat(HlsVideoSegmentFormat.MPEG2_TS)
            .setHlsSegmentFormat(HlsSegmentFormat.TS)
            .setMetadata(metadata)
            .build()
        val req = MediaLoadRequestData.Builder()
            .setMediaInfo(info)
            .setAutoplay(true)
            .setCurrentTime(pendingStartPositionMs)
            .build()
        Log.d(TAG, "load -> $url (start=${pendingStartPositionMs}ms)")
        runCatching {
            rmc.load(req).setResultCallback { result ->
                val st = result.status
                Log.d(
                    TAG,
                    "load result: success=${st.isSuccess} code=${st.statusCode} msg=${st.statusMessage}"
                )
            }
            rmc.registerCallback(object : RemoteMediaClient.Callback() {
                override fun onStatusUpdated() {
                    Log.d(TAG, "status: playerState=${rmc.playerState} idleReason=${rmc.idleReason}")
                }
            })
        }
        // Consuma l'istruzione di load: il proxy resta vivo (serve ancora lo stream), ma un
        // eventuale onSessionResumed successivo non deve ricaricare/riseek-are.
        pendingProxyUrl = null
        pendingMedia = null
    }

    fun pause() {
        runCatching { currentRemoteMediaClient()?.pause() }
    }

    fun resume() {
        runCatching { currentRemoteMediaClient()?.play() }
    }

    fun seek(positionMs: Long) {
        val rmc = currentRemoteMediaClient() ?: return
        runCatching {
            rmc.seek(MediaSeekOptions.Builder().setPosition(positionMs).build())
        }
    }

    /** Ferma riproduzione + sessione Cast + proxy. */
    fun stop() {
        runCatching { currentRemoteMediaClient()?.stop() }
        castContext?.sessionManager?.let { sm ->
            sessionListener?.let { runCatching { sm.removeSessionManagerListener(it, CastSession::class.java) } }
            runCatching { sm.endCurrentSession(true) }
        }
        sessionListener = null
        stopProxy()
    }

    // --- Stato per polling (parallelo a DlnaCastManager.positionInfo/transportState) ---

    /** Posizione/durata correnti in ms, null se nessuna sessione attiva. */
    fun positionInfo(): Pair<Long, Long>? {
        val rmc = currentRemoteMediaClient() ?: return null
        return rmc.approximateStreamPosition to rmc.streamDuration
    }

    /** Stato player Cast: PLAYER_STATE_PLAYING/PAUSED/BUFFERING/IDLE, null se nessuna sessione. */
    fun playerState(): Int? = currentRemoteMediaClient()?.playerState

    /** idleReason (es. IDLE_REASON_FINISHED) per rilevare la fine reale. */
    fun idleReason(): Int? = currentRemoteMediaClient()?.idleReason

    private fun currentRemoteMediaClient(): RemoteMediaClient? =
        castContext?.sessionManager?.currentCastSession?.remoteMediaClient

    private fun stopProxy() {
        runCatching { proxy?.stop() }
        proxy = null
        pendingProxyUrl = null
        pendingMedia = null
    }

    private fun wifiIpv4Address(): InetAddress? = runCatching {
        NetworkInterface.getNetworkInterfaces().asSequence()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.asSequence() }
            .firstOrNull { it is Inet4Address && it.isSiteLocalAddress }
    }.getOrNull()

    private companion object {
        const val TAG = "Chromecast"
    }
}