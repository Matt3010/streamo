package com.streamo.app.player.cast

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession
import com.streamo.app.MainActivity
import com.streamo.app.player.PlaybackService
import com.streamo.app.player.PlaybackSessionHolder
import com.streamo.app.player.dlna.DlnaCastManager
import com.streamo.app.player.dlna.DlnaRenderer
import com.streamo.app.player.dlna.DlnaSessionPlayer
import com.streamo.app.tmdb.TMDBImage
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
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

/** Sessione cast attiva. */
data class CastSession(val renderer: DlnaRenderer, val media: CastMedia)

/**
 * Possiede e gestisce la trasmissione DLNA a livello APP (non per-schermata): proxy HLS,
 * player media3 per la notifica, lock CPU/WiFi, polling posizione. Sopravvive alla chiusura
 * del player, così la trasmissione continua in background.
 */
@UnstableApi
@Singleton
class CastController @Inject constructor(
    @ApplicationContext private val appContext: Context
) {
    private val dlna = DlnaCastManager()
    private val scope = CoroutineScope(SupervisorJob() + kotlinx.coroutines.Dispatchers.Main.immediate)

    private val _renderers = MutableStateFlow<List<DlnaRenderer>>(emptyList())
    val renderers: StateFlow<List<DlnaRenderer>> = _renderers.asStateFlow()

    private val _scanning = MutableStateFlow(false)
    val scanning: StateFlow<Boolean> = _scanning.asStateFlow()

    private val _session = MutableStateFlow<CastSession?>(null)
    val session: StateFlow<CastSession?> = _session.asStateFlow()

    private val _isPlaying = MutableStateFlow(false)
    val isPlaying: StateFlow<Boolean> = _isPlaying.asStateFlow()

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

    fun discover() {
        scope.launch {
            _scanning.value = true
            _renderers.value = dlna.discover(appContext)
            _scanning.value = false
        }
    }

    /** Avvia la trasmissione. [startPositionMs] = posizione da cui riprendere sulla TV. */
    fun start(
        renderer: DlnaRenderer,
        streamUrl: String,
        headers: Map<String, String>,
        media: CastMedia,
        startPositionMs: Long
    ) {
        scope.launch {
            val ok = dlna.play(renderer, streamUrl, headers, media.displayTitle)
            if (!ok) return@launch
            if (startPositionMs > 5_000) {
                dlna.seek(renderer, startPositionMs)
                _position.value = startPositionMs
            } else {
                _position.value = 0
            }
            _duration.value = 0
            _isPlaying.value = true
            _session.value = CastSession(renderer, media)
            attachSession(media)
            acquireLocks()
            startPolling(renderer)
        }
    }

    fun stop() {
        val s = _session.value
        pollJob?.cancel(); pollJob = null
        seekJob?.cancel(); seekJob = null
        _session.value = null
        _isPlaying.value = false
        if (s != null) scope.launch { dlna.stop(s.renderer) }
        releaseLocks()
        PlaybackSessionHolder.castSession = null
        runCatching { castMediaSession?.release() }
        castMediaSession = null
        runCatching { sessionPlayer?.release() }
        sessionPlayer = null
        // Allinea il service (rimuove la sessione cast e aggiorna/chiude la notifica).
        runCatching { appContext.startService(Intent(appContext, PlaybackService::class.java)) }
    }

    fun togglePlay() = setPlaying(!_isPlaying.value)

    fun setPlaying(play: Boolean) {
        val s = _session.value ?: return
        if (_isPlaying.value == play) return
        _isPlaying.value = play
        scope.launch { if (play) dlna.resume(s.renderer) else dlna.pause(s.renderer) }
        sessionPlayer?.refresh()
    }

    /** Seek assoluto con debounce (raffiche di tap → una sola SOAP). */
    fun seekTo(positionMs: Long) {
        val s = _session.value ?: return
        val pos = positionMs.coerceAtLeast(0L)
        _position.value = pos
        sessionPlayer?.refresh()
        seekJob?.cancel()
        seekJob = scope.launch {
            delay(350)
            dlna.seek(s.renderer, pos)
        }
    }

    fun seekBy(deltaMs: Long) = seekTo(_position.value + deltaMs)

    private fun startPolling(renderer: DlnaRenderer) {
        pollJob?.cancel()
        pollJob = scope.launch {
            while (isActive && _session.value != null) {
                if (seekJob?.isActive != true) {
                    dlna.positionInfo(renderer)?.let { p ->
                        _position.value = p.positionMs
                        if (p.durationMs > 0) _duration.value = p.durationMs
                    }
                    sessionPlayer?.refresh()
                }
                delay(1000)
            }
        }
    }

    private fun attachSession(media: CastMedia) {
        val artworkUri = media.poster
            ?.let { TMDBImage.url(it, TMDBImage.Size.W500) }
            ?.let { android.net.Uri.parse(it) }
        val tvName = _session.value?.renderer?.friendlyName ?: "TV"
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
