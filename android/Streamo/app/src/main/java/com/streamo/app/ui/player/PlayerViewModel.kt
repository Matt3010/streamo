package com.streamo.app.ui.player

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.SeekParameters
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.session.MediaSession
import com.streamo.app.MainActivity
import com.streamo.app.player.PlaybackService
import com.streamo.app.player.PlaybackSessionHolder
import com.streamo.app.player.cast.CastController
import com.streamo.app.player.cast.CastMedia
import com.streamo.app.player.cast.CastSession
import com.streamo.app.player.chromecast.ChromecastRenderer
import com.streamo.app.player.dlna.DlnaRenderer
import com.streamo.app.player.lancast.LanRenderer
import com.streamo.app.data.local.entity.HistoryEntry
import com.streamo.app.data.local.entity.ProgressEntry
import com.streamo.app.data.preferences.SettingsDataStore
import com.streamo.app.data.repository.AppRepository
import com.streamo.app.download.DownloadGate
import com.streamo.app.download.DownloadInfrastructure
import com.streamo.app.download.ResolveAndDownloadWorker
import com.streamo.app.download.NetworkType
import com.streamo.app.data.remote.dto.TmdbItem
import com.streamo.app.provider.IntroSkipClient
import com.streamo.app.provider.PlaybackSource
import com.streamo.app.provider.ProviderDebugLogger
import com.streamo.app.provider.ProviderResolver
import com.streamo.app.provider.warp.WarpTunnel
import com.streamo.app.tmdb.TMDBClient
import com.streamo.app.util.ConnectivityHelper
import com.streamo.app.util.TVLogic
import kotlinx.coroutines.flow.first
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@UnstableApi
@HiltViewModel
class PlayerViewModel @Inject constructor(
    @ApplicationContext context: Context,
    private val savedStateHandle: SavedStateHandle,
    private val resolver: ProviderResolver,
    private val repository: AppRepository,
    private val settings: SettingsDataStore,
    private val client: TMDBClient,
    private val castController: CastController,
    private val warpTunnel: WarpTunnel,
    private val connectivityHelper: ConnectivityHelper,
    private val introSkipClient: IntroSkipClient
) : ViewModel() {

    val tmdbId: Int = savedStateHandle["tmdbId"] ?: 0
    val mediaType: String = savedStateHandle["mediaType"] ?: "movie"
    var season: Int = savedStateHandle["resumeSeason"] ?: 0
        private set
    var episode: Int = savedStateHandle["resumeEpisode"] ?: 0
        private set
    val title: String = savedStateHandle["title"] ?: ""
    val poster: String? = savedStateHandle["poster"]
    private val releaseDate: String? = savedStateHandle["releaseDate"]
    // Anime (AnimeUnity): id anime in tmdbId, episodeId AnimeUnity + slug per Referer embed.
    private val animeEpisodeId: Int = savedStateHandle["animeEpisodeId"] ?: 0
    private val animeSlug: String? = savedStateHandle["animeSlug"]

    val trackSelector: DefaultTrackSelector = DefaultTrackSelector(context).apply {
        setParameters(
            DefaultTrackSelector.Parameters.Builder(context)
                .setAllowVideoNonSeamlessAdaptiveness(false)
                .build()
        )
    }

    val player: ExoPlayer = run {
        // Keep media3's default decoder order (hardware first = fast seeking/decoding),
        // only demoting the emulator's "goldfish" decoder which produces green glitch
        // frames. On real devices this uses the hardware decoder; on the emulator it
        // falls through to a software decoder. Forcing software everywhere — the old
        // fix — made seeking very slow on real hardware.
        val renderersFactory = DefaultRenderersFactory(context)
            .setMediaCodecSelector { mimeType, requiresSecureDecoder, requiresTunnelingDecoder ->
                androidx.media3.exoplayer.mediacodec.MediaCodecUtil.getDecoderInfos(
                    mimeType,
                    requiresSecureDecoder,
                    requiresTunnelingDecoder
                ).sortedBy { info ->
                    if (info.name.contains("goldfish")) 1 else 0
                }
            }
            .setEnableDecoderFallback(true)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)

        // Retain 30s of already-played media so backward seeks (and seeks just
        // behind the playhead) resume instantly from buffer instead of re-fetching
        // the segment — which is what left the screen black for a few seconds.
        val loadControl = DefaultLoadControl.Builder()
            .setBackBuffer(30_000, true)
            .build()

        ExoPlayer.Builder(context, renderersFactory)
            .setTrackSelector(trackSelector)
            .setLoadControl(loadControl)
            .setSeekBackIncrementMs(10000)
            .setSeekForwardIncrementMs(10000)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                    .setUsage(C.USAGE_MEDIA)
                    .build(),
                true
            )
            .setSeekParameters(SeekParameters.CLOSEST_SYNC)
            .setVideoScalingMode(C.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING)
            .build()
    }

    private val appContext: Context = context

    /**
     * MediaSession wrapping [player] so the system shows the audio/media notification with
     * transport controls. Published to [PlaybackSessionHolder] and served by [PlaybackService].
     */
    private val mediaSession: MediaSession = run {
        val sessionActivity = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        // ID univoco per istanza: se il player viene riaperto mentre la vecchia
        // sessione non è ancora stata rilasciata (overlap di transizione), l'ID di
        // default "" collide e Media3 (più severo sulle versioni nuove di Android)
        // lancia "Session ID must be unique".
        MediaSession.Builder(context, player)
            .setId("streamo_player_" + java.util.UUID.randomUUID().toString())
            .setSessionActivity(sessionActivity)
            .build()
            .also {
                PlaybackSessionHolder.session = it
                context.startService(Intent(context, PlaybackService::class.java))
            }
    }

    /** URL/headers dello stream attualmente caricato (usati dal cast DLNA). */
    private var currentStreamUrl: String? = null
    private var currentHeaders: Map<String, String> = emptyMap()
    private var currentIsOffline = false
    // Whether the current resolution was obtained through WARP — online segments
    // are then fetched through the proxied OkHttp client to keep the IP masked.
    private var currentViaProxy = false

    /** Titolo per notifica/overlay: per le serie include "· S{s}E{e}". */
    fun displayTitle(): String =
        if (mediaType == "tv" && season > 0) "$title · S${season}E$episode" else title

    /** Nome episodio (TV), null per i film: usato come sottotitolo in locale. */
    private fun episodeSubtitle(): String? =
        if (mediaType == "tv" && season > 0) _episodeTitle.value?.takeIf { it.isNotBlank() } else null

    // --- Cast (DLNA + Obsidian + Chromecast) — delega al CastController app-scoped. ---

    val dlnaRenderers: StateFlow<List<DlnaRenderer>> = castController.dlnaRenderers
    val dlnaScanning: StateFlow<Boolean> = castController.dlnaScanning

    val lanRenderers: StateFlow<List<LanRenderer>> = castController.lanRenderers
    val lanScanning: StateFlow<Boolean> = castController.lanScanning

    val chromecastRenderers: StateFlow<List<ChromecastRenderer>> = castController.chromecastRenderers
    val chromecastScanning: StateFlow<Boolean> = castController.chromecastScanning

    /** Renderer DLNA su cui si trasmette QUESTO contenuto. */
    private val _dlnaConnected = MutableStateFlow<DlnaRenderer?>(null)
    val dlnaConnected: StateFlow<DlnaRenderer?> = _dlnaConnected.asStateFlow()

    /** Renderer Obsidian su cui si trasmette QUESTO contenuto. */
    private val _lanConnected = MutableStateFlow<LanRenderer?>(null)
    val lanConnected: StateFlow<LanRenderer?> = _lanConnected.asStateFlow()

    /** Renderer Chromecast su cui si trasmette QUESTO contenuto. */
    private val _chromecastConnected = MutableStateFlow<ChromecastRenderer?>(null)
    val chromecastConnected: StateFlow<ChromecastRenderer?> = _chromecastConnected.asStateFlow()

    /** True se questo contenuto è in cast (DLNA, Obsidian o Chromecast). */
    val isCastActive: Boolean get() = anyCastConnected()

    private fun anyCastConnected() =
        _dlnaConnected.value != null || _lanConnected.value != null || _chromecastConnected.value != null

    private fun castMatchesThis(s: CastSession?): Boolean =
        s != null && s.media.tmdbId == tmdbId && s.media.mediaType == mediaType &&
            s.media.season == season && s.media.episode == episode

    private fun buildCastMedia() = CastMedia(
        tmdbId = tmdbId, mediaType = mediaType, season = season, episode = episode,
        title = title, poster = poster, releaseDate = releaseDate, displayTitle = displayTitle()
    )

    fun discoverDlna() = castController.discover()

    /** Ferma la discovery Cast continua quando la modale si chiude (risparmio batteria). */
    fun stopCastDiscovery() = castController.stopDiscovery()

    /** Preferenze protocollo cast per dispositivo ("ip|name" → "streamo"|"dlna"). */
    val castProtocolPrefs: StateFlow<Map<String, String>> = settings.rendererProtocolPrefs
        .stateIn(viewModelScope, kotlinx.coroutines.flow.SharingStarted.Eagerly, emptyMap())

    /** Salva/azzera la preferenza protocollo per un dispositivo. protocol vuoto = azzera. */
    fun rememberCastProtocol(deviceKey: String, protocol: String) {
        val ip = deviceKey.substringBefore("|")
        val name = deviceKey.substringAfter("|", "")
        viewModelScope.launch {
            if (protocol.isBlank()) settings.clearProtocolPreference(ip, name)
            else settings.setProtocolPreference(ip, name, protocol)
        }
    }

    /** Trasmissione in sospeso in attesa di conferma: un'altra trasmissione è già attiva su un
     * contenuto diverso e MediaSession non tollera due sessioni con lo stesso ID — bisogna
     * fermare quella attuale prima di avviarne una nuova (mai farlo silenziosamente: l'utente
     * deve scegliere se interrompere il cast in corso o annullare). */
    sealed class PendingCastTarget {
        data class Dlna(val renderer: DlnaRenderer, val forceStreaming: Boolean) : PendingCastTarget()
        data class Lan(val renderer: LanRenderer) : PendingCastTarget()
        data class Chromecast(val renderer: ChromecastRenderer, val forceStreaming: Boolean) : PendingCastTarget()
    }

    private val _pendingCastSwitch = MutableStateFlow<PendingCastTarget?>(null)
    val pendingCastSwitch: StateFlow<PendingCastTarget?> = _pendingCastSwitch.asStateFlow()

    /** True se è in corso un cast per un contenuto DIVERSO da questo (stesso device o un altro). */
    private fun foreignCastActive(): Boolean {
        val s = castController.session.value
        return s != null && !castMatchesThis(s)
    }

    /** L'utente ha scelto di interrompere il cast in corso e avviare quello in sospeso. */
    fun confirmCastSwitch() {
        val target = _pendingCastSwitch.value ?: return
        _pendingCastSwitch.value = null
        castController.stop()
        when (target) {
            is PendingCastTarget.Dlna -> castToDlnaInternal(target.renderer, target.forceStreaming)
            is PendingCastTarget.Lan -> castToLanInternal(target.renderer)
            is PendingCastTarget.Chromecast -> castToChromecastInternal(target.renderer, target.forceStreaming)
        }
    }

    /** L'utente ha annullato: il cast in corso resta attivo, il nuovo stream non parte. */
    fun cancelCastSwitch() {
        _pendingCastSwitch.value = null
    }

    /** Avvia la trasmissione del contenuto corrente sul renderer e pausa il player locale. */
    fun castToDlna(renderer: DlnaRenderer, forceStreaming: Boolean = false) {
        if (foreignCastActive()) {
            _pendingCastSwitch.value = PendingCastTarget.Dlna(renderer, forceStreaming)
            return
        }
        castToDlnaInternal(renderer, forceStreaming)
    }

    private fun castToDlnaInternal(renderer: DlnaRenderer, forceStreaming: Boolean = false) {
        if (currentIsOffline && !forceStreaming) return // file locale non raggiungibile dal TV
        if (currentIsOffline && forceStreaming) {
            viewModelScope.launch {
                _loading.value = true
                _error.value = null
                try {
                    val resolution = if (mediaType == "tv" && season > 0) {
                        resolver.episodeSource(tmdbId, title, releaseDate, season, episode)
                    } else {
                        resolver.movieSource(tmdbId, title, releaseDate)
                    }
                    if (resolution.sources.isEmpty()) {
                        _loading.value = false
                        return@launch
                    }
                    val src = resolution.sources.first()
                    val pos = player.currentPosition.coerceAtLeast(0L)
                    player.pause()
                    val upstream = if (resolution.viaProxy) warpTunnel.proxiedClient() else null
                    castController.start(renderer, src.playlistUrl, src.headers, buildCastMedia(), pos, upstream)
                    _loading.value = false
                } catch (e: Exception) {
                    _loading.value = false
                    _error.value = "Errore nel risolvere lo stream per il cast"
                }
            }
            return
        }
        val url = currentStreamUrl ?: return
        val pos = player.currentPosition.coerceAtLeast(0L)
        // Stesso egress della riproduzione locale: con WARP il token vixcloud è IP-bound,
        // un fetch diretto del proxy verrebbe rifiutato con 403.
        val upstream = if (currentViaProxy) warpTunnel.proxiedClient() else null
        player.pause()
        castController.start(renderer, url, currentHeaders, buildCastMedia(), pos, upstream)
    }

    /** Avvia la trasmissione Obsidian (HTTP → app Obsidian sulla TV). */
    fun castToLan(renderer: LanRenderer) {
        if (foreignCastActive()) {
            _pendingCastSwitch.value = PendingCastTarget.Lan(renderer)
            return
        }
        castToLanInternal(renderer)
    }

    private fun castToLanInternal(renderer: LanRenderer) {
        viewModelScope.launch {
            val pos = player.currentPosition.coerceAtLeast(0L)
            player.pause()
            _loading.value = true
            _error.value = null
            val ok = castController.startLanCast(renderer, buildCastMedia(), pos)
            _loading.value = false
            if (!ok) {
                _error.value = "Impossibile connettersi alla TV " +
                    "(${renderer.host}:${renderer.port}). Verifica che l'app sia " +
                    "aperta sulla TV e sulla stessa rete."
            }
        }
    }

    /** Avvia la trasmissione Chromecast (Google Cast + proxy HLS locale). Come il DLNA:
     * serve uno stream online (il proxy gira sul telefono); l'offline non è raggiungibile. */
    fun castToChromecast(renderer: ChromecastRenderer, forceStreaming: Boolean = false) {
        if (foreignCastActive()) {
            _pendingCastSwitch.value = PendingCastTarget.Chromecast(renderer, forceStreaming)
            return
        }
        castToChromecastInternal(renderer, forceStreaming)
    }

    private fun castToChromecastInternal(renderer: ChromecastRenderer, forceStreaming: Boolean = false) {
        if (currentIsOffline && !forceStreaming) return
        if (currentIsOffline && forceStreaming) {
            viewModelScope.launch {
                _loading.value = true
                _error.value = null
                try {
                    val resolution = if (mediaType == "tv" && season > 0) {
                        resolver.episodeSource(tmdbId, title, releaseDate, season, episode)
                    } else {
                        resolver.movieSource(tmdbId, title, releaseDate)
                    }
                    if (resolution.sources.isEmpty()) {
                        _loading.value = false
                        return@launch
                    }
                    val src = resolution.sources.first()
                    val pos = player.currentPosition.coerceAtLeast(0L)
                    player.pause()
                    val upstream = if (resolution.viaProxy) warpTunnel.proxiedClient() else null
                    castController.startChromecast(renderer, src.playlistUrl, src.headers, buildCastMedia(), pos, upstream)
                    _loading.value = false
                } catch (e: Exception) {
                    _loading.value = false
                    _error.value = "Errore nel risolvere lo stream per il cast"
                }
            }
            return
        }
        val url = currentStreamUrl ?: return
        val pos = player.currentPosition.coerceAtLeast(0L)
        // Stesso egress della riproduzione locale: con WARP il token vixcloud è IP-bound,
        // un fetch diretto del proxy verrebbe rifiutato con 403.
        val upstream = if (currentViaProxy) warpTunnel.proxiedClient() else null
        player.pause()
        viewModelScope.launch {
            _loading.value = true
            _error.value = null
            val ok = castController.startChromecast(renderer, url, currentHeaders, buildCastMedia(), pos, upstream)
            _loading.value = false
            if (!ok) {
                _error.value = "Impossibile avviare la trasmissione su ${renderer.friendlyName}. " +
                    "Verifica che il Chromecast sia sulla stessa rete Wi-Fi."
            }
        }
    }

    fun stopCast() {
        val pos = _currentPosition.value
        castController.stop()
        // Riprende/avvia il locale: se non era mai stato caricato (riaggancio), carica.
        if (player.mediaItemCount == 0 || player.playbackState == Player.STATE_IDLE) {
            load()
        } else {
            player.seekTo(pos)
            player.play()
        }
    }

    data class TrackInfo(
        val groupIndex: Int,
        val trackIndex: Int,
        val label: String,
        val language: String?,
        /** Stable format id used to re-resolve the track after group order drifts (HLS). */
        val formatId: String? = null
    ) {
        val uniqueId: String get() = "${groupIndex}_${trackIndex}"
    }

    private val _audioTracks = MutableStateFlow<List<TrackInfo>>(emptyList())
    val audioTracks: StateFlow<List<TrackInfo>> = _audioTracks.asStateFlow()

    private val _subtitleTracks = MutableStateFlow<List<TrackInfo>>(emptyList())
    val subtitleTracks: StateFlow<List<TrackInfo>> = _subtitleTracks.asStateFlow()

    private val _selectedAudio = MutableStateFlow<TrackInfo?>(null)
    val selectedAudio: StateFlow<TrackInfo?> = _selectedAudio.asStateFlow()

    private val _selectedSubtitle = MutableStateFlow<TrackInfo?>(null)
    val selectedSubtitle: StateFlow<TrackInfo?> = _selectedSubtitle.asStateFlow()

    private val _videoTracks = MutableStateFlow<List<TrackInfo>>(emptyList())
    val videoTracks: StateFlow<List<TrackInfo>> = _videoTracks.asStateFlow()

    /** null = Auto (adaptive bitrate); non-null = quality locked to that track. */
    private val _selectedVideoQuality = MutableStateFlow<TrackInfo?>(null)
    val selectedVideoQuality: StateFlow<TrackInfo?> = _selectedVideoQuality.asStateFlow()

    /** Pref qualità streaming corrente (letto al init, aggiornabile dal menu). */
    private val _streamingLimit = MutableStateFlow("auto")
    val streamingLimit: StateFlow<String> = _streamingLimit.asStateFlow()

    /**
     * Altezza del variant video attualmente in riproduzione in modalità Auto (adattiva).
     * Aggiornata da `Player.Listener.onVideoSizeChanged`. `null` finché Media3 non
     * ha riportato la prima frame — la UI mostra il miglior valore noto in sua vece
     * (selectedVideoQuality o testa di videoTracks).
     */
    private val _currentAutoHeight = MutableStateFlow<Int?>(null)
    val currentAutoHeight: StateFlow<Int?> = _currentAutoHeight.asStateFlow()

    private val _playbackSpeed = MutableStateFlow(1f)
    val playbackSpeed: StateFlow<Float> = _playbackSpeed.asStateFlow()

    private val _currentSourceIndex = MutableStateFlow(0)
    val currentSourceIndex: StateFlow<Int> = _currentSourceIndex.asStateFlow()

    /** Last subtitle track explicitly enabled, so the quick toggle can re-enable it. */
    private var lastSubtitleTrack: TrackInfo? = null

    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _debugLogs = MutableStateFlow("")
    val debugLogs: StateFlow<String> = _debugLogs.asStateFlow()

    private val _sources = MutableStateFlow<List<PlaybackSource>>(emptyList())
    val sources: StateFlow<List<PlaybackSource>> = _sources.asStateFlow()

    private val _currentPosition = MutableStateFlow(0L)
    val currentPosition: StateFlow<Long> = _currentPosition.asStateFlow()

    private val _duration = MutableStateFlow(0L)
    val duration: StateFlow<Long> = _duration.asStateFlow()

    private val _bufferedPosition = MutableStateFlow(0L)
    val bufferedPosition: StateFlow<Long> = _bufferedPosition.asStateFlow()

    private val _isPlaying = MutableStateFlow(false)
    val isPlaying: StateFlow<Boolean> = _isPlaying.asStateFlow()

    private val _buffering = MutableStateFlow(false)
    val buffering: StateFlow<Boolean> = _buffering.asStateFlow()

    private val _nextEpisodeAvailable = MutableStateFlow(false)
    val nextEpisodeAvailable: StateFlow<Boolean> = _nextEpisodeAvailable.asStateFlow()

    private val _previousEpisodeAvailable = MutableStateFlow(false)
    val previousEpisodeAvailable: StateFlow<Boolean> = _previousEpisodeAvailable.asStateFlow()

    private val _seekingManually = MutableStateFlow(false)
    val seekingManually: StateFlow<Boolean> = _seekingManually.asStateFlow()

    private val _playbackEnded = MutableStateFlow(false)
    val playbackEnded: StateFlow<Boolean> = _playbackEnded.asStateFlow()

    /** Riproduzione offline (file in cache locale): non trasmettibile, il TV non lo raggiunge. */
    private val _isOfflinePlayback = MutableStateFlow(false)
    val isOfflinePlayback: StateFlow<Boolean> = _isOfflinePlayback.asStateFlow()

    /** WARP attivo: mostra il badge "maschera IP" durante il caricamento dello stream. */
    val warpEnabled: StateFlow<Boolean> = settings.warpEnabled
        .stateIn(viewModelScope, kotlinx.coroutines.flow.SharingStarted.Eagerly, false)

    private val _currentSeason = MutableStateFlow(season)
    val currentSeason: StateFlow<Int> = _currentSeason.asStateFlow()

    private val _currentEpisode = MutableStateFlow(episode)
    val currentEpisode: StateFlow<Int> = _currentEpisode.asStateFlow()

    /** Episode name (TV only) shown under the series title; null/blank if unknown. */
    private val _episodeTitle = MutableStateFlow<String?>(null)
    val episodeTitle: StateFlow<String?> = _episodeTitle.asStateFlow()

    // --- Skip intro / credits (TheIntroDB) ---

    /** Affordance visibile alla posizione corrente, o null quando non applicabile. */
    enum class SkipPrompt {
        INTRO,
        CREDITS
    }

    data class SkipSegment(
        val startMs: Long,
        val endMs: Long
    )

    private val _skipPrompt = MutableStateFlow<SkipPrompt?>(null)
    val skipPrompt: StateFlow<SkipPrompt?> = _skipPrompt.asStateFlow()

    private val _skipSegment = MutableStateFlow<SkipSegment?>(null)
    val skipSegment: StateFlow<SkipSegment?> = _skipSegment.asStateFlow()

    private var skipSegments: IntroSkipClient.Segments? = null
    private var didFetchSkipSegments = false
    /** Token monotono: invalida i risultati di un fetch skip-segments avviato per
     *  un episodio precedente se `resetSkipState()` è già scattato per il nuovo
     *  episodio prima che il fetch risolvesse (mirror di [seekToken]). */
    private var skipFetchGeneration = 0L
    private var introDismissed = false
    private var creditsDismissed = false

    // ---

    /** Ordered CDN mirrors of the same vixcloud embed; we fall through them on failure. */
    private var playbackSources: List<PlaybackSource> = emptyList()
    private var sourceIndex = 0
    private var pendingResumePositionMs: Long = 0

    private var tmdbItem: TmdbItem? = null

    private fun applyStreamingLimit(pref: String) {
        val params = trackSelector.buildUponParameters()
        when (pref) {
            "max" -> params.setMaxVideoSize(Int.MAX_VALUE, Int.MAX_VALUE)
            "1080" -> params.setMaxVideoSize(Int.MAX_VALUE, 1080)
            "720" -> params.setMaxVideoSize(Int.MAX_VALUE, 720)
            "480" -> params.setMaxVideoSize(Int.MAX_VALUE, 480)
            // "auto" = adaptive normale, lascia i parametri di default.
        }
        trackSelector.setParameters(params.build())
    }

    init {
        // Applica il cap qualità streaming in base alla rete attuale.
        viewModelScope.launch {
            val netType = connectivityHelper.currentNetworkType()
            val pref = if (netType == NetworkType.WIFI) settings.streamingQualityWifi.first()
            else settings.streamingQualityMobile.first()
            _streamingLimit.value = pref
            applyStreamingLimit(pref)
            // Se la preferenza salvata è "Massima" i track non sono ancora noti qui
            // (arrivano con onPlaybackStateChanged → STATE_READY → refreshAvailableTracks).
            // Ci agganciamo lì con [lockBestIfMaxRequested].
        }

        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                _buffering.value = state == Player.STATE_BUFFERING
                if (state == Player.STATE_READY) {
                    _duration.value = player.duration.coerceAtLeast(0L)
                    _loading.value = false
                    refreshAvailableTracks()
                    // Resume playback after manual seek once decoder is ready.
                    // Proteggiamo anche da isScrubbing: durante lo scrub TV il player
                    // deve restare in pausa congelato; un vecchio job non deve riportarlo
                    // in play a metà pressione.
                    if (!_seekingManually.value && !isScrubbing && !player.isPlaying) {
                        player.play()
                    }
                    // Fetch skip segments once the item is seekable and duration is known.
                    maybeFetchSkipSegments()
                }
                if (state == Player.STATE_ENDED) {
                    _playbackEnded.value = true
                    onPlaybackEnded()
                }
            }

            override fun onTracksChanged(tracks: androidx.media3.common.Tracks) {
                refreshAvailableTracks()
            }

            override fun onVideoSizeChanged(videoSize: androidx.media3.common.VideoSize) {
                // Altezza del variant attualmente renderizzato. In Auto è il valore
                // che ABR ha scelto; con override manuale è quello del track bloccato.
                // Usato dalla modale qualità per annotare "Auto (Xp)".
                if (videoSize.height > 0) _currentAutoHeight.value = videoSize.height
            }

            override fun onIsPlayingChanged(playing: Boolean) {
                // In trasmissione lo stato play arriva dal CastController, non dal locale.
                if (!anyCastConnected()) _isPlaying.value = playing
            }

            override fun onPlayerError(e: PlaybackException) {
                // This mirror failed — fall through to the next server
                advanceToNextSource()
            }
        })

        // Posizione locale (solo quando NON stiamo trasmettendo questo contenuto).
        viewModelScope.launch {
            while (true) {
                if (!anyCastConnected()) {
                    _currentPosition.value = player.currentPosition.coerceAtLeast(0L)
                    _bufferedPosition.value = player.bufferedPosition.coerceAtLeast(0L)
                }
                updateSkipPrompt()
                delay(1000)
            }
        }

        // Aggancia questo contenuto se è quello in trasmissione, e specchia lo stato cast.
        viewModelScope.launch {
            castController.session.collect { s ->
                if (castMatchesThis(s)) {
                    when (s) {
                        is CastSession.Dlna -> {
                            _dlnaConnected.value = s.renderer
                            _lanConnected.value = null
                            _chromecastConnected.value = null
                        }
                        is CastSession.Lan -> {
                            _lanConnected.value = s.renderer
                            _dlnaConnected.value = null
                            _chromecastConnected.value = null
                        }
                        is CastSession.Chromecast -> {
                            _chromecastConnected.value = s.renderer
                            _dlnaConnected.value = null
                            _lanConnected.value = null
                        }
                        null -> {
                            _dlnaConnected.value = null
                            _lanConnected.value = null
                            _chromecastConnected.value = null
                        }
                    }
                } else {
                    _dlnaConnected.value = null
                    _lanConnected.value = null
                    _chromecastConnected.value = null
                }
            }
        }
        viewModelScope.launch {
            castController.position.collect {
                if (anyCastConnected()) _currentPosition.value = it
            }
        }
        viewModelScope.launch {
            castController.duration.collect {
                if (anyCastConnected() && it > 0) _duration.value = it
            }
        }
        viewModelScope.launch {
            castController.isPlaying.collect {
                if (anyCastConnected()) _isPlaying.value = it
            }
        }
        // Specchia il caricamento della TV: durante l'avvio cast il player locale è in pausa
        // e non emette STATE_BUFFERING, quindi il telefono mostrerebbe il tasto play invece
        // dello spinner. Lo riusiamo come "buffering" così l'overlay di caricamento appare.
        viewModelScope.launch {
            castController.loading.collect {
                if (anyCastConnected()) _buffering.value = it
            }
        }

        // Riaggancio: se il CastController trasmette già questo contenuto non caricare il
        // locale (la trasmissione è in corso); altrimenti avvia normalmente.
        if (castMatchesThis(castController.session.value)) {
            val s = castController.session.value
            when (s) {
                is CastSession.Dlna -> _dlnaConnected.value = s.renderer
                is CastSession.Lan -> _lanConnected.value = s.renderer
                is CastSession.Chromecast -> _chromecastConnected.value = s.renderer
                null -> {}
            }
            _loading.value = false
        } else {
            load()
        }
    }

    /** Ids of downloads we paused for this streaming session, to re-enqueue on exit. */
    private val pausedForStreamingIds = mutableListOf<Int>()
    private var didPauseForStreaming = false

    /**
     * Pause worker-based downloads while ONLINE streaming. Sets the global gate (stops any
     * worker that starts) and cancels the currently-running ones, marking them paused.
     * User-paused downloads are left alone so we don't auto-resume them. Not called for
     * offline playback — watching a downloaded title keeps the queue running.
     */
    private suspend fun pauseDownloadsForStreaming() {
        if (didPauseForStreaming) return
        didPauseForStreaming = true
        DownloadGate.streamingActive.set(true)
        repository.getActiveDownloads()
            .filter { it.status != "paused" }
            .forEach {
                ResolveAndDownloadWorker.cancel(appContext, it.id)
                repository.updateDownloadStatus(it.id, "paused")
                pausedForStreamingIds.add(it.id)
            }
    }

    fun replay() {
        _playbackEnded.value = false
        if (isCastActive) {
            castController.seekTo(0)
            return
        }
        player.seekTo(0)
        player.play()
    }

    fun load() {
        _playbackEnded.value = false
        ProviderDebugLogger.clear()
        resetSkipState()
        // Evita che, durante il gap prima dello STATE_READY del nuovo episodio,
        // il poll a 1s e updateSkipPrompt() confrontino la posizione/durata
        // dell'episodio precedente con soglie (90% crediti, 95% prossimo episodio).
        _duration.value = 0L
        _currentPosition.value = 0L
        viewModelScope.launch {
            _loading.value = true
            _error.value = null
            _debugLogs.value = ""
            try {
                // Load saved progress for resume
                pendingResumePositionMs = 0
                val savedProgress = repository.getProgressByCoordinate(tmdbId, mediaType, season, episode)
                savedProgress?.let {
                    if (it.durationSeconds > 0 && it.positionSeconds > 10 &&
                        it.positionSeconds < it.durationSeconds * TVLogic.WATCHED_THRESHOLD
                    ) {
                        pendingResumePositionMs = (it.positionSeconds * 1000).toLong()
                    }
                }

                // Load TMDB details to check if next episode actually exists
                if (mediaType == "tv" && season > 0) {
                    try {
                        tmdbItem = client.details(tmdbId, "tv")
                    } catch (_: Exception) {
                        tmdbItem = null
                    }
                    // Episode name for the player title's second line.
                    _episodeTitle.value = try {
                        client.seasonDetails(tmdbId, season).episodes
                            ?.firstOrNull { it.episodeNumber == episode }?.name
                    } catch (_: Exception) {
                        null
                    }
                } else {
                    _episodeTitle.value = null
                }

                // Check if we have a completed download for this content (offline playback)
                val contentId = "${tmdbId}_${mediaType}_${season}_${episode}"
                val downloadEntry = repository.getDownloadByContentId(contentId)
                if (downloadEntry != null && downloadEntry.status == "completed" && downloadEntry.streamUrl.isNotBlank()) {
                    // Offline playback: leave the download queue running.
                    val resumePos = pendingResumePositionMs
                    pendingResumePositionMs = 0
                    playStreamFromUrl(downloadEntry.streamUrl, emptyMap(), forceOffline = true, startPositionMs = resumePos)
                    checkAdjacentEpisodes()
                    return@launch
                }

                // Online playback → pause downloads to preserve bandwidth.
                pauseDownloadsForStreaming()

                // Online: resolve stream URL via the provider pipeline
                val resolution = when {
                    mediaType == "anime" ->
                        resolver.animeSource(tmdbId, animeSlug, animeEpisodeId)
                    mediaType == "tv" && season > 0 ->
                        resolver.episodeSource(tmdbId, title, releaseDate, season, episode)
                    else ->
                        resolver.movieSource(tmdbId, title, releaseDate)
                }

                if (resolution.sources.isEmpty()) {
                    _error.value = resolution.message ?: "Titolo non disponibile"
                    _debugLogs.value = ProviderDebugLogger.getLogs()
                    _loading.value = false
                    return@launch
                }

                currentViaProxy = resolution.viaProxy
                playbackSources = resolution.sources
                sourceIndex = 0
                _sources.value = resolution.sources
                loadCurrentSource()
                checkAdjacentEpisodes()

                // Save provider mapping for future reuse
                resolution.providerTitle?.let { resolved ->
                    resolver.saveMapping(tmdbId, mediaType, com.streamo.app.provider.ProviderResolveTitleOutcome(
                        resolved = resolved,
                        reason = null,
                        candidates = resolution.candidates,
                        matchStatus = com.streamo.app.provider.ProviderMatchStatus.AUTO_CONFIRMED
                    ))
                }
            } catch (e: Exception) {
                _error.value = e.localizedMessage ?: "Titolo non disponibile"
                _debugLogs.value = ProviderDebugLogger.getLogs()
                _loading.value = false
            }
        }
    }

    private fun loadCurrentSource() {
        if (sourceIndex >= playbackSources.size) {
            _error.value = "Titolo non disponibile"
            _debugLogs.value = ProviderDebugLogger.getLogs()
            _loading.value = false
            return
        }
        val source = playbackSources[sourceIndex]
        _currentSourceIndex.value = sourceIndex
        val resumePos = pendingResumePositionMs
        pendingResumePositionMs = 0
        playStreamFromUrl(source.playlistUrl, source.headers, startPositionMs = resumePos)
    }

    private fun advanceToNextSource() {
        sourceIndex++
        if (sourceIndex < playbackSources.size) {
            loadCurrentSource()
        } else {
            _error.value = "Riproduzione non disponibile"
            _loading.value = false
        }
    }

    private fun playStreamFromUrl(
        url: String,
        headers: Map<String, String>,
        forceOffline: Boolean = false,
        startPositionMs: Long = 0
    ) {
        currentStreamUrl = url
        currentHeaders = headers
        currentIsOffline = forceOffline
        _isOfflinePlayback.value = forceOffline
        val factory = if (forceOffline) {
            // Offline playback. A download grabs only ONE video rendition + the default
            // audio (stream keys), but the cached master playlist still advertises every
            // rendition (all subtitle/audio/video variants). The player can auto-select an
            // un-downloaded rendition (e.g. a locale-matched subtitle/audio) whose segments
            // aren't on disk — a cache-only factory then throws "PlaceholderDataSource
            // cannot be opened" and playback dies. Use the shared cache+upstream factory
            // (vixcloud headers, FLAG_IGNORE_CACHE_ON_ERROR): the downloaded rendition still
            // plays from disk, and any missing rendition falls through to the network.
            DownloadInfrastructure.cacheDataSourceFactory
        } else {
            // Build an upstream DataSource.Factory with vixcloud headers. When the
            // resolution went through WARP, route segment fetches through the
            // proxied OkHttp client too, so playback egresses from the Cloudflare
            // IP (not just the metadata resolve). Falls back to direct if the
            // tunnel dropped between resolve and playback.
            val proxiedClient = if (currentViaProxy) warpTunnel.proxiedClient() else null
            val upstreamFactory: androidx.media3.datasource.DataSource.Factory = if (proxiedClient != null) {
                OkHttpDataSource.Factory(proxiedClient).apply {
                    if (headers.isNotEmpty()) setDefaultRequestProperties(headers)
                }
            } else {
                DefaultHttpDataSource.Factory().apply {
                    if (headers.isNotEmpty()) setDefaultRequestProperties(headers)
                }
            }

            // Use CacheDataSource.Factory: cached segments are served from disk,
            // network requests fall through to the upstream factory. Stream into the
            // bounded playbackCache (LRU-capped) — NOT the download cache, which uses a
            // NoOp evictor and would accumulate every segment of a long movie on disk
            // until the device runs out of storage (seen on low-storage Firestick).
            CacheDataSource.Factory()
                .setCache(DownloadInfrastructure.playbackCache)
                .setUpstreamDataSourceFactory(upstreamFactory)
                .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
        }

        val artworkUri = poster?.let { com.streamo.app.tmdb.TMDBImage.url(it, com.streamo.app.tmdb.TMDBImage.Size.W500) }?.let { android.net.Uri.parse(it) }
        val mediaItem = MediaItem.Builder()
            .setUri(url)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(displayTitle())
                    .setArtist(episodeSubtitle())
                    .setArtworkUri(artworkUri)
                    .build()
            )
            .build()

        val mediaSource = HlsMediaSource.Factory(factory)
            .createMediaSource(mediaItem)
        // Pass the resume position before prepare so ExoPlayer starts loading the
        // target segment directly. Seeking after STATE_READY caused resumed playback
        // to hang/black-screen because the player first buffered from time 0.
        player.setMediaSource(mediaSource, startPositionMs.coerceAtLeast(0L))
        player.prepare()
        player.playWhenReady = true
    }

    fun selectSource(source: PlaybackSource) {
        val pos = player.currentPosition
        val idx = playbackSources.indexOf(source)
        if (idx >= 0) {
            sourceIndex = idx
            _currentSourceIndex.value = idx
        }
        playStreamFromUrl(source.playlistUrl, source.headers, startPositionMs = pos)
    }

    fun setPlaybackSpeed(speed: Float) {
        player.setPlaybackSpeed(speed)
        _playbackSpeed.value = speed
    }

    /** Gate per i salti discreti ±10s. */
    private var isSeeking = false

    /** Gate separato per lo scrub TV: un tap non può mai essere perso per colpa di un
     *  seek-render job precedente che finisce in ritardo. */
    private var isScrubbing = false

    /** Token monotonico: solo l'ultimo seek/scrub avviato può azzerare il freeze-frame.
     *  La cancellazione del job precedente è cooperativa, quindi il suo `finally` può
     *  ancora eseguire dopo che un nuovo scrub è iniziato: confrontiamo il token e
     *  ignoriamo la pulizia se non siamo più il job attivo. */
    private var seekToken = 0L

    private var seekRenderJob: Job? = null

    private var scrubWasPlaying = false

    /**
     * Tiene attivo il freeze-frame finché il decoder non ha davvero renderizzato un
     * frame nuovo e pulito dopo il seek. I primi frame post-seek possono avere una
     * colonna verde (padding del decoder che la TextureView non croppa subito); un
     * delay fisso non basta sui primi seek di sessione (decoder freddo, buffering
     * lungo). Qui aspettiamo STATE_READY (adattivo) + un margine di qualche frame.
     */
    private fun awaitSeekRendered(wasPlaying: Boolean) {
        val token = ++seekToken
        seekRenderJob?.cancel()
        seekRenderJob = viewModelScope.launch {
            try {
                var waited = 0
                while (isActive && player.playbackState != Player.STATE_READY && waited < 4000) {
                    delay(16); waited += 16
                }
                // Non riportare in play se un altro scrub/seek ha già invalidato questo job.
                if (isActive && seekToken == token && wasPlaying) player.play()
                // Solo il job attuale può tenere il freeze-frame per il margine di frame puliti.
                if (isActive && seekToken == token) delay(220)
            } finally {
                // Solo il job attuale può sganciare i gate.
                if (seekToken == token) {
                    isSeeking = false
                    _seekingManually.value = false
                }
            }
        }
    }

    private fun performSeek(action: () -> Unit) {
        if (isSeeking || isScrubbing) return
        isSeeking = true
        // Mostra il freeze-frame anche per i salti ±10s: maschera il bordo verde.
        _seekingManually.value = true
        // playWhenReady (intento), non isPlaying: al primo seek post-load lo stato può
        // non essere ancora READY (isPlaying=false) pur volendo riprodurre.
        val wasPlaying = player.playWhenReady
        action()
        awaitSeekRendered(wasPlaying)
    }

    /** Pausa il player locale (es. all'apertura della modale di trasmissione). */
    fun pausePlayback() {
        if (!isCastActive && player.isPlaying) player.pause()
    }

    fun togglePlayPause() {
        if (isCastActive) {
            castController.togglePlay()
            return
        }
        if (player.isPlaying) player.pause() else player.play()
    }

    fun seekBack() {
        if (isCastActive) {
            castController.seekBy(-10_000)
            return
        }
        performSeek { player.seekBack() }
    }

    fun seekForward() {
        if (isCastActive) {
            castController.seekBy(10_000)
            return
        }
        performSeek { player.seekForward() }
    }

    /**
     * Seek relativo di un importo arbitrario (ms, negativo = indietro). Usato dallo skip
     * mobile a raffica: i tap accumulano il totale e questo fa UN UNICO seek alla fine
     * (debounce), invece di N seek da 10s che ricaricherebbero il decoder a ogni tap.
     */
    fun seekBy(deltaMs: Long) {
        if (isCastActive) {
            castController.seekBy(deltaMs)
            return
        }
        performSeek {
            val maxPos = player.duration.coerceAtLeast(0L)
            val target = player.currentPosition + deltaMs
            player.seekTo(
                if (maxPos > 0L) target.coerceIn(0L, maxPos) else target.coerceAtLeast(0L)
            )
        }
    }

    fun seekTo(positionMs: Long) {
        // Cast: il seek lo esegue il dispositivo remoto (debounce gestito dal CastController).
        if (isCastActive) {
            castController.seekTo(positionMs)
            return
        }
        if (isSeeking || isScrubbing) return
        isSeeking = true
        _seekingManually.value = true
        // Cattura l'intento PRIMA di pause() (che azzera playWhenReady).
        val wasPlaying = player.playWhenReady
        player.pause()
        player.seekTo(positionMs)
        awaitSeekRendered(wasPlaying)
    }

    // MARK: - Scrub (TV seekbar focalizzata)

    /** Inizia lo scrub: invalida il job precedente, resetta i gate, pausa e congela il frame. */
    fun beginScrub() {
        if (isCastActive || isScrubbing) return
        seekRenderJob?.cancel()
        ++seekToken
        isSeeking = false
        isScrubbing = true
        _seekingManually.value = true
        scrubWasPlaying = player.playWhenReady
        player.pause()
    }

    /** Committa lo scrub con un solo seek assoluto al rilascio. */
    fun commitScrubTo(positionMs: Long) {
        if (isCastActive) {
            castController.seekTo(positionMs)
            return
        }
        if (!isScrubbing) return
        isScrubbing = false
        player.seekTo(positionMs)
        awaitSeekRendered(scrubWasPlaying)
    }

    /** Annulla uno scrub aperto senza committare (es. uscita dalla composizione). */
    fun cancelScrub() {
        if (!isScrubbing) return
        isScrubbing = false
        _seekingManually.value = false
    }

    // MARK: - Skip intro / credits

    private fun resetSkipState() {
        skipFetchGeneration++
        didFetchSkipSegments = false
        introDismissed = false
        creditsDismissed = false
        skipSegments = null
        _skipPrompt.value = null
        _skipSegment.value = null
    }

    private fun maybeFetchSkipSegments() {
        // Skip per TMDB id assente o anime (id AnimeUnity non è TMDB → TheIntroDB
        // non ha skip data; niente next-episode TMDB). L'offline NON è escluso:
        // serve solo una chiamata di rete per i metadata, non per lo stream video,
        // quindi funziona anche per i download finché il device ha connessione.
        if (didFetchSkipSegments || tmdbId <= 0 || mediaType == "anime") return
        didFetchSkipSegments = true
        val generation = skipFetchGeneration
        val durationMs = _duration.value.takeIf { it > 0 }
        viewModelScope.launch {
            val segs = introSkipClient.fetch(
                tmdbId = tmdbId,
                isMovie = mediaType == "movie",
                season = season,
                episode = episode,
                durationMs = durationMs
            )
            // L'episodio potrebbe essere cambiato durante la richiesta: se
            // resetSkipState() è scattato nel frattempo, skipFetchGeneration
            // non coincide più e scartiamo questo risultato stale.
            if (generation == skipFetchGeneration) {
                skipSegments = segs
                updateSkipPrompt()
            }
        }
    }

    private fun updateSkipPrompt() {
        val t = _currentPosition.value / 1000.0
        if (!t.isFinite()) return
        val durSec = _duration.value / 1000.0

        val segs = skipSegments
        val introStartSec = segs?.introStartMs?.let { it / 1000.0 } ?: 0.0
        val introEndSec = segs?.introEndMs?.let { it / 1000.0 }
        val creditsStartSec = segs?.creditsStartMs?.let { it / 1000.0 }

        // Nessuna stima sulla durata totale: senza un timestamp reale da TheIntroDB
        // non sappiamo dove iniziano i crediti (varia troppo da episodio a episodio),
        // quindi niente pulsante piuttosto che uno che scatta a un punto casuale.
        val effectiveCreditsStart = creditsStartSec

        val newPrompt: SkipPrompt?
        val newSegment: SkipSegment?

        if (!introDismissed && introEndSec != null && t >= introStartSec && t < introEndSec - 1) {
            newPrompt = SkipPrompt.INTRO
            newSegment = SkipSegment(
                startMs = segs?.introStartMs ?: 0L,
                endMs = segs?.introEndMs ?: 0L
            )
        } else if (!creditsDismissed && effectiveCreditsStart != null && t >= effectiveCreditsStart) {
            newPrompt = SkipPrompt.CREDITS
            val endSec = if (durSec.isFinite() && durSec > effectiveCreditsStart) durSec else effectiveCreditsStart + 1
            newSegment = SkipSegment(
                startMs = (effectiveCreditsStart * 1000).toLong(),
                endMs = (endSec * 1000).toLong()
            )
        } else {
            newPrompt = null
            newSegment = null
        }
        if (_skipPrompt.value != newPrompt) _skipPrompt.value = newPrompt
        if (_skipSegment.value != newSegment) _skipSegment.value = newSegment
    }

    /** Esegue l'azione del bottone skip visibile (intro o credits). */
    fun performSkip() {
        val prompt = _skipPrompt.value ?: return
        when (prompt) {
            SkipPrompt.INTRO -> {
                introDismissed = true
                val endMs = _skipSegment.value?.endMs ?: skipSegments?.introEndMs ?: return
                seekTo(endMs)
            }
            SkipPrompt.CREDITS -> {
                creditsDismissed = true
                // Salta alla fine del video.
                val dur = _duration.value
                val target = if (dur > 0L) (dur - 1000L).coerceAtLeast(0L) else 0L
                seekTo(target)
            }
        }
        _skipPrompt.value = null
        _skipSegment.value = null
    }

    fun playNextEpisode() {
        if (mediaType != "tv" || season == 0) return
        val next = TVLogic.nextEpisode(tmdbItem ?: return, season, episode) ?: return
        saveCurrentProgress()
        season = next.first
        episode = next.second
        _currentSeason.value = season
        _currentEpisode.value = episode
        savedStateHandle["resumeSeason"] = season
        savedStateHandle["resumeEpisode"] = episode
        load()
    }

    fun playPreviousEpisode() {
        if (mediaType != "tv" || season == 0) return
        val prev = TVLogic.previousEpisode(tmdbItem ?: return, season, episode) ?: return
        saveCurrentProgress()
        season = prev.first
        episode = prev.second
        _currentSeason.value = season
        _currentEpisode.value = episode
        savedStateHandle["resumeSeason"] = season
        savedStateHandle["resumeEpisode"] = episode
        load()
    }

    private fun checkAdjacentEpisodes() {
        val item = tmdbItem ?: return
        _nextEpisodeAvailable.value = TVLogic.nextEpisode(item, season, episode) != null
        _previousEpisodeAvailable.value = TVLogic.previousEpisode(item, season, episode) != null
    }

    private fun onPlaybackEnded() {
        viewModelScope.launch {
            val durationSec = (player.duration.coerceAtLeast(0L) / 1000.0)
            repository.saveProgress(
                ProgressEntry(
                    tmdbId = tmdbId,
                    mediaType = mediaType,
                    season = season,
                    episode = episode,
                    positionSeconds = durationSec,
                    durationSeconds = durationSec,
                    title = title,
                    posterPath = poster,
                    providerEpisodeId = if (mediaType == "anime") animeEpisodeId else null,
                    providerSlug = if (mediaType == "anime") animeSlug else null
                )
            )
            repository.addToHistory(
                HistoryEntry(
                    tmdbId = tmdbId,
                    mediaType = mediaType,
                    title = title,
                    posterPath = poster,
                    season = season,
                    episode = episode,
                    progressSeconds = durationSec,
                    durationSeconds = durationSec
                )
            )

            // Auto-delete watched downloads (≥90%)
            if (settings.autoDeleteWatched.first()) {
                val contentId = "${tmdbId}_${mediaType}_${season}_${episode}"
                val download = repository.getDownloadByContentId(contentId)
                if (download != null && download.status == "completed") {
                    val progressList = repository.progress().first()
                    val entry = progressList.find { it.tmdbId == tmdbId && it.mediaType == mediaType && it.season == season && it.episode == episode }
                    val pct = if (entry != null && entry.durationSeconds > 0) {
                        entry.positionSeconds / entry.durationSeconds * 100
                    } else 100.0
                    if (pct >= 90.0) {
                        repository.removeDownload(download.id)
                        try {
                            DownloadInfrastructure.downloadManager.removeDownload(download.contentId)
                        } catch (_: Exception) { }
                    }
                }
            }

        }
    }

    fun saveCurrentProgress() {
        viewModelScope.launch {
            val posSec = (player.currentPosition.coerceAtLeast(0L) / 1000.0)
            val durSec = (player.duration.coerceAtLeast(0L) / 1000.0)
            repository.saveProgress(
                ProgressEntry(
                    tmdbId = tmdbId,
                    mediaType = mediaType,
                    season = season,
                    episode = episode,
                    positionSeconds = posSec,
                    durationSeconds = durSec,
                    title = title,
                    posterPath = poster,
                    providerEpisodeId = if (mediaType == "anime") animeEpisodeId else null,
                    providerSlug = if (mediaType == "anime") animeSlug else null
                )
            )
            // Record in history as soon as the user has watched a meaningful chunk,
            // mirroring iOS saveHistory (don't wait for playback to fully end).
            if (posSec > 5) {
                repository.addToHistory(
                    HistoryEntry(
                        tmdbId = tmdbId,
                        mediaType = mediaType,
                        title = title,
                        posterPath = poster,
                        season = season,
                        episode = episode,
                        progressSeconds = posSec,
                        durationSeconds = durSec
                    )
                )
            }
        }
    }

    /**
     * Salva un progress entry per contenuto esterno (es. comando cast Obsidian),
     * così il prossimo [load] lo riprende automaticamente alla posizione voluta.
     *
     * Preserva titolo/poster/durata reali se già presenti: [ProgressEntry] usa REPLACE su
     * chiave composta, quindi scrivere title="" sovrascriverebbe la card Continue Watching.
     */
    fun saveExternalStartPosition(
        tmdbId: Int,
        mediaType: String,
        season: Int,
        episode: Int,
        positionMs: Long,
        title: String = "",
        posterPath: String? = null
    ) {
        viewModelScope.launch {
            val posSec = (positionMs / 1000.0)
            val existing = repository.getProgressByCoordinate(tmdbId, mediaType, season, episode)
            // Mantieni la durata reale se nota; altrimenti valore alto fittizio così il
            // resume check (>10s, <90%) passa.
            val dur = existing?.durationSeconds?.takeIf { it > posSec } ?: (posSec + 3600.0)
            repository.saveProgress(
                ProgressEntry(
                    tmdbId = tmdbId,
                    mediaType = mediaType,
                    season = season,
                    episode = episode,
                    positionSeconds = posSec,
                    durationSeconds = dur,
                    title = title.ifBlank { existing?.title ?: "" },
                    posterPath = posterPath ?: existing?.posterPath
                )
            )
        }
    }

    private fun formatTrackLabel(format: androidx.media3.common.Format, type: Int): String {
        val rawLabel = format.label?.trim()?.takeIf { it.isNotBlank() }
        val rawLang = format.language?.trim()?.takeIf { it.isNotBlank() && it != "und" }
        val langDisplay = rawLang?.let { code ->
            try {
                val locale = java.util.Locale(code)
                val display = locale.displayLanguage
                if (display.isNotBlank() && display != code) display.replaceFirstChar { it.uppercase() } else code.replaceFirstChar { it.uppercase() }
            } catch (_: Exception) { code.replaceFirstChar { it.uppercase() } }
        }
        return rawLabel ?: langDisplay ?: when (type) {
            C.TRACK_TYPE_AUDIO -> "Audio"
            C.TRACK_TYPE_TEXT -> "Sottotitoli"
            else -> "Traccia"
        }
    }

    fun refreshAvailableTracks() {
        val currentTracks = player.currentTracks
        val audio = mutableListOf<TrackInfo>()
        val subtitles = mutableListOf<TrackInfo>()
        val video = mutableListOf<TrackInfo>()

        currentTracks.groups.forEachIndexed { groupIndex, group ->
            for (trackIndex in 0 until group.length) {
                val format = group.getTrackFormat(trackIndex)
                val label = formatTrackLabel(format, group.type)
                ProviderDebugLogger.log("TRACK group=$groupIndex track=$trackIndex type=${group.type} label='$label' lang=${format.language} format=${format.id}")
                when (group.type) {
                    C.TRACK_TYPE_AUDIO -> {
                        if (group.isTrackSupported(trackIndex)) {
                            audio.add(TrackInfo(groupIndex, trackIndex, label, format.language, format.id))
                        }
                    }
                    C.TRACK_TYPE_TEXT -> {
                        // Skip tracks the renderer can't decode: selecting them shows nothing.
                        if (group.isTrackSupported(trackIndex)) {
                            subtitles.add(TrackInfo(groupIndex, trackIndex, label, format.language, format.id))
                        }
                    }
                    C.TRACK_TYPE_VIDEO -> {
                        // Quality = resolution height; only supported variants with a known height.
                        if (group.isTrackSupported(trackIndex) && format.height > 0) {
                            video.add(TrackInfo(groupIndex, trackIndex, "${format.height}p", null, format.id))
                        }
                    }
                }
            }
        }
        _audioTracks.value = audio
        _subtitleTracks.value = subtitles
        _videoTracks.value = video
            .distinctBy { it.label }
            .sortedByDescending { it.label.removeSuffix("p").toIntOrNull() ?: 0 }
        // Keep the locked quality only if that variant still exists, else fall back to Auto.
        _selectedVideoQuality.value = _selectedVideoQuality.value?.let { sel ->
            _videoTracks.value.firstOrNull { it.formatId == sel.formatId }
        }
        // Se la preferenza corrente è "Massima" e nessun override è ancora attivo,
        // blocca il variant più alto non appena lo conosciamo. Così l'utente vede
        // davvero la qualità massima fin dal primo frame, non un ABR oscillante.
        if (_streamingLimit.value == "max" && _selectedVideoQuality.value == null) {
            _videoTracks.value.firstOrNull()?.let { selectVideoQuality(it) }
        }
        ProviderDebugLogger.log("TRACKS audio=${audio.size} subtitles=${subtitles.size} video=${video.size}")

        _selectedAudio.value = audio.firstOrNull { info ->
            val group = currentTracks.groups.getOrNull(info.groupIndex)
            group != null && group.isTrackSelected(info.trackIndex)
        }
        _selectedSubtitle.value = subtitles.firstOrNull { info ->
            val group = currentTracks.groups.getOrNull(info.groupIndex)
            group != null && group.isTrackSelected(info.trackIndex)
        }
    }

    /**
     * Re-resolve a [TrackInfo] against the CURRENT player tracks. The stored [TrackInfo.groupIndex]
     * is only a hint: HLS adds/reorders groups as the manifest loads, so the positional index can
     * point to the wrong (or non-matching) group by the time the user taps. Match by format id
     * first, then language+label, always validating the group [type].
     */
    private fun resolveTrack(track: TrackInfo, type: Int): Pair<androidx.media3.common.Tracks.Group, Int>? {
        val groups = player.currentTracks.groups
        // 1) positional hint, if still valid and consistent
        groups.getOrNull(track.groupIndex)?.let { g ->
            if (g.type == type && track.trackIndex < g.length) {
                val f = g.getTrackFormat(track.trackIndex)
                if (track.formatId == null || f.id == track.formatId) return g to track.trackIndex
            }
        }
        // 2) search every group of the right type
        groups.forEach { g ->
            if (g.type != type) return@forEach
            for (i in 0 until g.length) {
                val f = g.getTrackFormat(i)
                val idMatch = track.formatId != null && f.id == track.formatId
                val langLabelMatch = f.language == track.language && formatTrackLabel(f, type) == track.label
                if (idMatch || langLabelMatch) return g to i
            }
        }
        return null
    }

    fun selectAudioTrack(track: TrackInfo) {
        val (group, idx) = resolveTrack(track, C.TRACK_TYPE_AUDIO) ?: return
        player.trackSelectionParameters = player.trackSelectionParameters
            .buildUpon()
            .setOverrideForType(
                androidx.media3.common.TrackSelectionOverride(group.mediaTrackGroup, listOf(idx))
            )
            .build()
        _selectedAudio.value = track
    }

    fun selectSubtitleTrack(track: TrackInfo) {
        val (group, idx) = resolveTrack(track, C.TRACK_TYPE_TEXT) ?: return
        val disabled = player.trackSelectionParameters.disabledTrackTypes - C.TRACK_TYPE_TEXT
        player.trackSelectionParameters = player.trackSelectionParameters
            .buildUpon()
            .setDisabledTrackTypes(disabled)
            .clearOverridesOfType(C.TRACK_TYPE_TEXT)
            .setOverrideForType(
                androidx.media3.common.TrackSelectionOverride(group.mediaTrackGroup, listOf(idx))
            )
            .build()
        _selectedSubtitle.value = track
        lastSubtitleTrack = track
    }

    /** Lock playback to a single video variant (fixed quality). */
    fun selectVideoQuality(track: TrackInfo) {
        val (group, idx) = resolveTrack(track, C.TRACK_TYPE_VIDEO) ?: return
        player.trackSelectionParameters = player.trackSelectionParameters
            .buildUpon()
            .setOverrideForType(
                androidx.media3.common.TrackSelectionOverride(group.mediaTrackGroup, listOf(idx))
            )
            .build()
        _selectedVideoQuality.value = track
    }

    /** Restore adaptive bitrate (Auto). */
    fun setAutoVideoQuality() {
        player.trackSelectionParameters = player.trackSelectionParameters
            .buildUpon()
            .clearOverridesOfType(C.TRACK_TYPE_VIDEO)
            .build()
        _selectedVideoQuality.value = null
    }

    /** Modifica il limite qualità streaming dal menu del player. */
    fun setStreamingLimit(pref: String) {
        _streamingLimit.value = pref
        if (pref == "max") {
            // "Massima" = blocca il variant più alto tra quelli noti. Senza lock
            // esplicito, ABR resterebbe a oscillare e l'utente non vedrebbe mai la
            // qualità effettivamente riprodotta. applyStreamingLimit("max") toglie
            // ogni tetto — selectVideoQuality lo applica al miglior track.
            val best = _videoTracks.value.firstOrNull()
            if (best != null) {
                selectVideoQuality(best)
            } else {
                // Track non ancora noti: rimuovi un eventuale override precedente,
                // così al primo refreshAvailableTracks il lock prenderà il top.
                if (_selectedVideoQuality.value != null) setAutoVideoQuality()
            }
        } else {
            // Resetta override qualità manuale se attivo, così ABR può scegliere
            // entro il nuovo cap. Tranne se il lock proveniva da "max" e l'utente
            // ha appena cambiato rete/pref — in quel caso l'override va rimosso.
            if (_selectedVideoQuality.value != null) setAutoVideoQuality()
        }
        applyStreamingLimit(pref)
        viewModelScope.launch {
            val netType = connectivityHelper.currentNetworkType()
            if (netType == NetworkType.WIFI) settings.setStreamingQualityWifi(pref)
            else settings.setStreamingQualityMobile(pref)
        }
    }

    fun disableSubtitles() {
        val disabled = player.trackSelectionParameters.disabledTrackTypes + C.TRACK_TYPE_TEXT
        player.trackSelectionParameters = player.trackSelectionParameters
            .buildUpon()
            .setDisabledTrackTypes(disabled)
            .clearOverridesOfType(C.TRACK_TYPE_TEXT)
            .build()
        _selectedSubtitle.value = null
    }

    /** Quick toggle from the top bar: off → re-enable last (or first) track, on → disable. */
    fun toggleSubtitles() {
        if (_selectedSubtitle.value != null) {
            lastSubtitleTrack = _selectedSubtitle.value
            disableSubtitles()
        } else {
            val target = lastSubtitleTrack?.let { last ->
                _subtitleTracks.value.firstOrNull { it.formatId != null && it.formatId == last.formatId }
            } ?: _subtitleTracks.value.firstOrNull()
            target?.let { selectSubtitleTrack(it) }
        }
    }

    override fun onCleared() {
        saveCurrentProgress()
        PlaybackSessionHolder.session = null
        mediaSession.release()
        // Ferma il service SOLO se non c'è una trasmissione cast attiva (altrimenti la
        // notifica/proxy del cast in background morirebbero col player).
        if (castController.session.value == null) {
            try {
                appContext.stopService(Intent(appContext, PlaybackService::class.java))
            } catch (_: Exception) {
            }
        } else {
            // Riallinea il service: rimuove la sessione locale, tiene quella cast.
            try {
                appContext.startService(Intent(appContext, PlaybackService::class.java))
            } catch (_: Exception) {
            }
        }
        player.release()

        // Resume the downloads we paused for streaming. Reset all to "pending" in DB
        // so the queue observer picks them up. Only enqueue the first one via WorkManager
        // (REPLACE policy means only one worker at a time); advanceQueue handles the rest.
        if (didPauseForStreaming) {
            DownloadGate.streamingActive.set(false)
            kotlinx.coroutines.runBlocking {
                pausedForStreamingIds.forEach { id ->
                    repository.updateDownloadStatus(id, "pending")
                }
            }
            pausedForStreamingIds.firstOrNull()?.let { ResolveAndDownloadWorker.enqueue(appContext, it) }
        }

        super.onCleared()
    }
}