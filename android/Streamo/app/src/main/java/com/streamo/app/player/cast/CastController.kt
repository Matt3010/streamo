package com.streamo.app.player.cast

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession
import com.streamo.app.MainActivity
import com.streamo.app.player.PlaybackService
import com.streamo.app.player.PlaybackSessionHolder
import com.streamo.app.player.chromecast.ChromecastManager
import com.streamo.app.player.chromecast.ChromecastRenderer
import com.streamo.app.player.dlna.DlnaCastManager
import com.streamo.app.player.dlna.DlnaRenderer
import com.streamo.app.player.dlna.DlnaSessionPlayer
import com.streamo.app.player.lancast.LanCastClient
import com.streamo.app.player.lancast.LanRenderer
import com.streamo.app.tmdb.TMDBImage
import com.google.android.gms.cast.MediaStatus
import com.google.android.gms.cast.framework.media.RemoteMediaClient
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/** Contenuto trasmesso, per ricostruire titolo/notifica e riaprire il player. */
data class CastMedia(
    val tmdbId: Int,
    val mediaType: String,
    val season: Int,
    val episode: Int,
    val title: String,
    val poster: String?,
    val releaseDate: String?,
    val displayTitle: String
)

/** Sessione cast attiva, con protocollo specifico. */
sealed class CastSession {
    abstract val media: CastMedia
    abstract val rendererName: String

    data class Dlna(val renderer: DlnaRenderer, override val media: CastMedia) : CastSession() {
        override val rendererName: String get() = renderer.friendlyName
    }
    data class Lan(val renderer: LanRenderer, override val media: CastMedia) : CastSession() {
        override val rendererName: String get() = renderer.friendlyName
    }
    data class Chromecast(val renderer: ChromecastRenderer, override val media: CastMedia) : CastSession() {
        override val rendererName: String get() = renderer.friendlyName
    }
}

/**
 * Possiede e gestisce la trasmissione a livello APP (non per-schermata): proxy HLS (solo DLNA),
 * player media3 per la notifica, lock CPU/WiFi, polling posizione. Sopravvive alla chiusura
 * del player, così la trasmissione continua in background.
 *
 * Supporta due protocolli:
 * - **DLNA** (UPnP/SSDP → SOAP AVTransport) per smart TV generiche
 * - **Obsidian** (NSD → HTTP REST) per app Obsidian su Android TV / Fire TV
 */
@UnstableApi
@Singleton
class CastController @Inject constructor(
    @ApplicationContext private val appContext: Context
) {
    private val dlna = DlnaCastManager()
    private val lanClient = LanCastClient()
    private val chromecast = ChromecastManager(appContext)
    private val scope = CoroutineScope(SupervisorJob() + kotlinx.coroutines.Dispatchers.Main.immediate)

    // --- Renderer discovery ---

    private val _dlnaRenderers = MutableStateFlow<List<DlnaRenderer>>(emptyList())
    val dlnaRenderers: StateFlow<List<DlnaRenderer>> = _dlnaRenderers.asStateFlow()

    private val _lanRenderers = MutableStateFlow<List<LanRenderer>>(emptyList())
    val lanRenderers: StateFlow<List<LanRenderer>> = _lanRenderers.asStateFlow()

    private val _dlnaScanning = MutableStateFlow(false)
    val dlnaScanning: StateFlow<Boolean> = _dlnaScanning.asStateFlow()

    private val _lanScanning = MutableStateFlow(false)
    val lanScanning: StateFlow<Boolean> = _lanScanning.asStateFlow()

    val chromecastRenderers: StateFlow<List<ChromecastRenderer>> = chromecast.renderers
    val chromecastScanning: StateFlow<Boolean> = chromecast.scanning

    // --- Sessione e stato playback ---

    private val _session = MutableStateFlow<CastSession?>(null)
    val session: StateFlow<CastSession?> = _session.asStateFlow()

    private val _isPlaying = MutableStateFlow(false)
    val isPlaying: StateFlow<Boolean> = _isPlaying.asStateFlow()

    /**
     * True mentre la TV sta caricando/bufferizzando il contenuto (prima che parta la
     * riproduzione). Il telefono lo specchia in uno spinner invece di mostrare il tasto
     * play/pausa, che altrimenti sembrerebbe "fermo" durante l'avvio.
     */
    private val _loading = MutableStateFlow(false)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()

    private val _position = MutableStateFlow(0L)
    val position: StateFlow<Long> = _position.asStateFlow()

    private val _duration = MutableStateFlow(0L)
    val duration: StateFlow<Long> = _duration.asStateFlow()

    private var sessionPlayer: DlnaSessionPlayer? = null
    private var castMediaSession: MediaSession? = null
    private var wifiLock: android.net.wifi.WifiManager.WifiLock? = null
    private var wakeLock: android.os.PowerManager.WakeLock? = null
    private var pollJob: Job? = null
    private var seekJob: Job? = null

    /** Contatore errori consecutivi nel polling Obsidian (dopo 3 → sessione persa). */
    private var lanPollFailures = 0

    /**
     * Stato "stopped" consecutivi nel polling Obsidian. Richiede 2 letture (≈2s) prima di
     * terminare: un cambio contenuto (re-cast/episodio) fa passare la TV per un breve
     * "stopped" durante la transizione di schermata; un solo campione lo ucciderebbe.
     */
    private var lanStoppedStreak = 0

    /**
     * True una volta che la TV ha riportato uno stato attivo (playing/paused/loading).
     * Prima della conferma "stopped" è solo l'app TV che sta ancora avviando il player
     * (cold start), NON fine riproduzione: ignorarlo o la sessione muore subito.
     */
    private var lanActiveConfirmed = false

    /** Letture "stopped" in attesa del primo avvio TV; oltre la soglia → TV non parte. */
    private var lanLaunchPolls = 0

    /** True una volta che la TV DLNA ha riportato lo stato PLAYING almeno una volta. */
    private var dlnaPlayConfirmed = false

    /**
     * Nudge di Play durante l'avvio DLNA: alcune TV accettano SetAVTransportURI ma non
     * avviano la riproduzione finché non ricevono un secondo Play. Conta i tentativi.
     */
    private var dlnaLaunchPolls = 0

    /**
     * Tick di polling in cui il RemoteMediaClient Chromecast è ancora null o IDLE non-finale:
     * la sessione Cast sta ancora partendo (il load avviene in onSessionStarted). Oltre la
     * soglia (~30s) la sessione non si è mai avviata → termina invece di restare in loading.
     */
    private var chromecastLaunchPolls = 0

    // --- Discovery ---

    fun discover() {
        scope.launch {
            _dlnaScanning.value = true
            _lanScanning.value = true
            // Cast discovery è continua (callback MediaRouter): parte subito e si auto-aggiorna.
            chromecast.startDiscovery()
            coroutineScope {
                val dlnaJob = async { dlna.discover(appContext) }
                val lanJob = async { lanClient.discover(appContext) }
                _dlnaRenderers.value = dlnaJob.await()
                _lanRenderers.value = lanJob.await()
            }
            _dlnaScanning.value = false
            _lanScanning.value = false
            // La discovery Cast non ha un "fine": chiudi la finestra dello spinner insieme a
            // DLNA/Obsidian, altrimenti `chromecastScanning` resterebbe true per sempre e la
            // modale mostrerebbe "Ricerca dispositivi…" all'infinito. La callback resta attiva.
            chromecast.endScanningWindow()
        }
    }

    /**
     * Ferma la discovery Cast continua (rimuove la callback MediaRouter). Da chiamare quando la
     * modale di scelta cast si chiude: la discovery Cast è attiva (drain batteria/CPU) finché la
     * callback è registrata, a differenza di DLNA/Obsidian che sono scansioni one-shot. NON
     * influisce su una sessione cast già avviata (quella vive nel SessionManager).
     */
    fun stopDiscovery() {
        chromecast.stopDiscovery()
    }

    // --- Start ---

    /** Avvia la trasmissione DLNA (SOAP + proxy HLS). */
    fun start(
        renderer: DlnaRenderer,
        streamUrl: String,
        headers: Map<String, String>,
        media: CastMedia,
        startPositionMs: Long,
        upstreamClient: okhttp3.OkHttpClient? = null
    ) {
        scope.launch {
            val ok = dlna.play(renderer, streamUrl, headers, media.displayTitle, upstreamClient)
            if (!ok) return@launch
            if (startPositionMs > 5_000) {
                dlna.seek(renderer, startPositionMs)
                _position.value = startPositionMs
            } else {
                _position.value = 0
            }
            _duration.value = 0
            // Sessione PRIMA di isPlaying: il collector isPlaying di PlayerViewModel è gated
            // sullo stato del renderer connesso, che diventa non-null solo quando il collector
            // della sessione osserva _session. Emettere isPlaying prima lo fa scartare (lo
            // StateFlow non ri-consegna il valore invariato) e il telefono resta in pausa.
            _session.value = CastSession.Dlna(renderer, media)
            dlnaPlayConfirmed = false
            dlnaLaunchPolls = 0
            _isPlaying.value = true
            // loading DOPO la sessione: il collector del telefono è gated sul renderer
            // connesso (impostato dal collector di _session), e lo StateFlow non riconsegna
            // un valore invariato — emetterlo prima lo farebbe scartare.
            _loading.value = true
            attachSession(media)
            acquireLocks()
            startPolling()
        }
    }

    /**
     * Avvia la trasmissione Obsidian (HTTP → TV Obsidian).
     * @return true se la TV ha accettato il comando di play, false altrimenti
     * (così il chiamante può mostrare un errore invece di fallire in silenzio).
     */
    suspend fun startLanCast(
        renderer: LanRenderer,
        media: CastMedia,
        startPositionMs: Long
    ): Boolean {
        val ok = lanClient.play(renderer, media, startPositionMs)
        if (!ok) return false
        _position.value = startPositionMs
        _duration.value = 0
        // Sessione PRIMA di isPlaying — vedi nota in start(): il collector isPlaying del
        // telefono è gated sul renderer connesso, impostato dal collector della sessione.
        _session.value = CastSession.Lan(renderer, media)
        _isPlaying.value = true
        // loading DOPO la sessione, stesso motivo: lo StateFlow non riconsegna un valore
        // invariato, quindi emetterlo prima del renderer connesso lo farebbe scartare.
        _loading.value = true
        lanPollFailures = 0
        lanStoppedStreak = 0
        lanActiveConfirmed = false
        lanLaunchPolls = 0
        attachSession(media)
        acquireLocks()
        startPolling()
        return true
    }

    /**
     * Avvia la trasmissione Chromecast (Google Cast SDK + proxy HLS locale).
     * @return true se il proxy è partito e il route è stato selezionato; il load del media
     * avviene poi in autonomia alla conferma della sessione Cast.
     */
    suspend fun startChromecast(
        renderer: ChromecastRenderer,
        streamUrl: String,
        headers: Map<String, String>,
        media: CastMedia,
        startPositionMs: Long,
        upstreamClient: okhttp3.OkHttpClient? = null
    ): Boolean {
        val ok = chromecast.play(renderer, streamUrl, headers, media, startPositionMs, upstreamClient)
        if (!ok) return false
        _position.value = startPositionMs
        _duration.value = 0
        // Sessione PRIMA di isPlaying — vedi nota in start(): il collector isPlaying del
        // telefono è gated sul renderer connesso, impostato dal collector della sessione.
        _session.value = CastSession.Chromecast(renderer, media)
        _isPlaying.value = true
        // loading DOPO la sessione, stesso motivo: lo StateFlow non riconsegna un valore
        // invariato, quindi emetterlo prima del renderer connesso lo farebbe scartare.
        _loading.value = true
        chromecastLaunchPolls = 0
        attachSession(media)
        acquireLocks()
        startPolling()
        return true
    }

    // --- Stop ---

    fun stop() {
        val s = _session.value
        pollJob?.cancel(); pollJob = null
        seekJob?.cancel(); seekJob = null
        _session.value = null
        _isPlaying.value = false
        _loading.value = false
        _position.value = 0
        _duration.value = 0
        if (s != null) {
            scope.launch {
                when (s) {
                    is CastSession.Dlna -> dlna.stop(s.renderer)
                    is CastSession.Lan -> lanClient.stop(s.renderer)
                    is CastSession.Chromecast -> chromecast.stop()
                }
            }
        }
        releaseLocks()
        PlaybackSessionHolder.castSession = null
        runCatching { castMediaSession?.release() }
        castMediaSession = null
        runCatching { sessionPlayer?.release() }
        sessionPlayer = null
        runCatching { appContext.startService(Intent(appContext, PlaybackService::class.java)) }
    }

    // --- Playback controls ---

    fun togglePlay() = setPlaying(!_isPlaying.value)

    fun setPlaying(play: Boolean) {
        val s = _session.value ?: return
        if (_isPlaying.value == play) return
        _isPlaying.value = play
        scope.launch {
            when (s) {
                is CastSession.Dlna -> if (play) dlna.resume(s.renderer) else dlna.pause(s.renderer)
                is CastSession.Lan -> if (play) lanClient.resume(s.renderer) else lanClient.pause(s.renderer)
                is CastSession.Chromecast -> if (play) chromecast.resume() else chromecast.pause()
            }
        }
        sessionPlayer?.refresh()
    }

    /** Seek assoluto con debounce. */
    fun seekTo(positionMs: Long) {
        val s = _session.value ?: return
        val pos = positionMs.coerceAtLeast(0L)
        _position.value = pos
        sessionPlayer?.refresh()
        seekJob?.cancel()
        seekJob = scope.launch {
            delay(350)
            when (s) {
                is CastSession.Dlna -> dlna.seek(s.renderer, pos)
                is CastSession.Lan -> lanClient.seek(s.renderer, pos)
                is CastSession.Chromecast -> chromecast.seek(pos)
            }
        }
    }

    fun seekBy(deltaMs: Long) = seekTo(_position.value + deltaMs)

    // --- Polling ---

    private fun startPolling() {
        pollJob?.cancel()
        pollJob = scope.launch {
            while (isActive && _session.value != null) {
                if (seekJob?.isActive != true) {
                    val s = _session.value
                    when (s) {
                        is CastSession.Dlna -> {
                            dlna.positionInfo(s.renderer)?.let { p ->
                                _position.value = p.positionMs
                                if (p.durationMs > 0) _duration.value = p.durationMs
                            }
                            // Specchia lo stato reale della TV: senza, il bottone play resta
                            // sul valore iniziale e si desincronizza se la TV viene messa in
                            // pausa/play dal telecomando.
                            when (dlna.transportState(s.renderer)) {
                                "PLAYING" -> { _isPlaying.value = true; dlnaPlayConfirmed = true; _loading.value = false }
                                "PAUSED_PLAYBACK" -> { _isPlaying.value = false; _loading.value = false }
                                null -> {}
                                else -> {
                                    // TRANSITIONING / STOPPED / NO_MEDIA_PRESENT: in avvio
                                    // alcune TV accettano SetAVTransportURI ma non partono
                                    // finché non ricevono un secondo Play. Insisti per qualche
                                    // tick finché non confermano PLAYING (poi smetti).
                                    if (!dlnaPlayConfirmed && dlnaLaunchPolls < 5) {
                                        dlnaLaunchPolls++
                                        dlna.resume(s.renderer)
                                    }
                                }
                            }
                            sessionPlayer?.refresh()
                        }
                        is CastSession.Lan -> {
                            val st = lanClient.status(s.renderer)
                            if (st != null) {
                                lanPollFailures = 0
                                if (st.status == "stopped") {
                                    if (lanActiveConfirmed) {
                                        // La TV stava riproducendo: 2 "stopped" consecutivi
                                        // (≈2s) = fine reale (un singolo può essere un re-cast).
                                        lanStoppedStreak++
                                        if (lanStoppedStreak >= 2) {
                                            stop()
                                            return@launch
                                        }
                                    } else {
                                        // App TV ancora in avvio (cold start): attendi senza
                                        // azzerare la posizione, ma rinuncia dopo ~30s.
                                        lanLaunchPolls++
                                        if (lanLaunchPolls >= 30) {
                                            stop()
                                            return@launch
                                        }
                                    }
                                } else {
                                    // playing/paused/loading: la TV è viva, aggancia lo stato.
                                    lanActiveConfirmed = true
                                    lanStoppedStreak = 0
                                    // Specchia lo stato reale: il bottone play sul telefono
                                    // deve seguire la TV, non restare sul valore iniziale.
                                    _isPlaying.value = (st.status == "playing")
                                    _loading.value = (st.status == "loading")
                                    _position.value = st.positionMs
                                    if (st.durationMs > 0) _duration.value = st.durationMs
                                }
                            } else {
                                lanPollFailures++
                                if (lanPollFailures >= 3) {
                                    stop()
                                    return@launch
                                }
                            }
                            sessionPlayer?.refresh()
                        }
                        is CastSession.Chromecast -> {
                            // RemoteMediaClient può essere null mentre la sessione Cast sta ancora
                            // partendo (il load avviene in onSessionStarted). In attesa: loading.
                            val state = chromecast.playerState()
                            if (state == null) {
                                // Sessione non ancora avviata: attendi, ma rinuncia dopo ~30s
                                // (handshake fallito / device irraggiungibile), altrimenti loading
                                // resterebbe per sempre — come lanLaunchPolls/dlnaLaunchPolls.
                                chromecastLaunchPolls++
                                if (chromecastLaunchPolls >= 30) {
                                    stop()
                                    return@launch
                                }
                                _loading.value = true
                            } else {
                                chromecast.positionInfo()?.let { (pos, dur) ->
                                    _position.value = pos
                                    if (dur > 0) _duration.value = dur
                                }
                                when (state) {
                                    MediaStatus.PLAYER_STATE_PLAYING -> {
                                        _isPlaying.value = true; _loading.value = false
                                        chromecastLaunchPolls = 0
                                    }
                                    MediaStatus.PLAYER_STATE_PAUSED -> {
                                        _isPlaying.value = false; _loading.value = false
                                        chromecastLaunchPolls = 0
                                    }
                                    MediaStatus.PLAYER_STATE_BUFFERING -> {
                                        _loading.value = true
                                        chromecastLaunchPolls = 0
                                    }
                                    MediaStatus.PLAYER_STATE_IDLE -> {
                                        // IDLE con IDLE_REASON_FINISHED (o ERROR) = fine reale.
                                        // IDLE iniziale (prima del load) = ancora in avvio: conta
                                        // come launch poll così un load che non parte mai termina.
                                        val reason = chromecast.idleReason()
                                        if (reason == MediaStatus.IDLE_REASON_FINISHED ||
                                            reason == MediaStatus.IDLE_REASON_ERROR
                                        ) {
                                            stop()
                                            return@launch
                                        }
                                        chromecastLaunchPolls++
                                        if (chromecastLaunchPolls >= 30) {
                                            stop()
                                            return@launch
                                        }
                                        _loading.value = true
                                    }
                                }
                            }
                            sessionPlayer?.refresh()
                        }
                        null -> {} // sessione già terminata
                    }
                }
                delay(1000)
            }
        }
    }

    // --- Session attachment (notifica media) ---

    private fun attachSession(media: CastMedia) {
        val artworkUri = media.poster
            ?.let { TMDBImage.url(it, TMDBImage.Size.W500) }
            ?.let { android.net.Uri.parse(it) }
        val tvName = _session.value?.rendererName ?: "TV"
        val sp = DlnaSessionPlayer(
            looper = android.os.Looper.getMainLooper(),
            title = media.displayTitle,
            artist = "Trasmissione su $tvName",
            artworkUri = artworkUri,
            isPlayingProvider = { _isPlaying.value },
            positionProvider = { _position.value },
            durationProvider = { _duration.value },
            onSetPlayWhenReady = { play -> setPlaying(play) },
            onSeekTo = { pos -> seekTo(pos) },
            onStop = { stop() }
        )
        sessionPlayer = sp
        val sessionActivity = PendingIntent.getActivity(
            appContext, 1,
            Intent(appContext, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        castMediaSession = MediaSession.Builder(appContext, sp)
            .setId("streamo-cast")
            .setSessionActivity(sessionActivity)
            .build()
        PlaybackSessionHolder.castSession = castMediaSession
        runCatching { appContext.startService(Intent(appContext, PlaybackService::class.java)) }
    }

    // --- Locks ---

    private fun acquireLocks() {
        if (wakeLock?.isHeld == true) return
        runCatching {
            val wifi = appContext.getSystemService(Context.WIFI_SERVICE) as? android.net.wifi.WifiManager
            wifiLock = wifi?.createWifiLock(
                android.net.wifi.WifiManager.WIFI_MODE_FULL_HIGH_PERF, "streamo:cast"
            )?.apply { acquire() }
            val power = appContext.getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager
            wakeLock = power?.newWakeLock(
                android.os.PowerManager.PARTIAL_WAKE_LOCK, "streamo:cast"
            )?.apply { acquire(3 * 60 * 60 * 1000L) }
        }
    }

    private fun releaseLocks() {
        runCatching { if (wifiLock?.isHeld == true) wifiLock?.release() }
        runCatching { if (wakeLock?.isHeld == true) wakeLock?.release() }
        wifiLock = null
        wakeLock = null
    }
}
