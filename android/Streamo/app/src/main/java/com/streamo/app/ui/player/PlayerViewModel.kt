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
import com.streamo.app.player.dlna.DlnaRenderer
import com.streamo.app.player.streamo.StreamoRenderer
import com.streamo.app.data.local.entity.HistoryEntry
import com.streamo.app.data.local.entity.ProgressEntry
import com.streamo.app.data.preferences.SettingsDataStore
import com.streamo.app.data.repository.StreamoRepository
import com.streamo.app.download.DownloadGate
import com.streamo.app.download.DownloadInfrastructure
import com.streamo.app.download.ResolveAndDownloadWorker
import com.streamo.app.data.remote.dto.TmdbItem
import com.streamo.app.provider.PlaybackSource
import com.streamo.app.provider.ProviderDebugLogger
import com.streamo.app.provider.ProviderResolver
import com.streamo.app.tmdb.TMDBClient
import com.streamo.app.util.TVLogic
import kotlinx.coroutines.flow.first
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
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
    private val repository: StreamoRepository,
    private val settings: SettingsDataStore,
    private val client: TMDBClient,
    private val castController: CastController
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
        MediaSession.Builder(context, player)
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

    /** Titolo per notifica/overlay: per le serie include "· S{s}E{e}". */
    fun displayTitle(): String =
        if (mediaType == "tv" && season > 0) "$title · S${season}E$episode" else title

    /** Nome episodio (TV), null per i film: usato come sottotitolo in locale. */
    private fun episodeSubtitle(): String? =
        if (mediaType == "tv" && season > 0) _episodeTitle.value?.takeIf { it.isNotBlank() } else null

    // --- Cast (DLNA + Streamo) — delega al CastController app-scoped. ---

    val dlnaRenderers: StateFlow<List<DlnaRenderer>> = castController.dlnaRenderers
    val dlnaScanning: StateFlow<Boolean> = castController.dlnaScanning

    val streamoRenderers: StateFlow<List<StreamoRenderer>> = castController.streamoRenderers
    val streamoScanning: StateFlow<Boolean> = castController.streamoScanning

    /** Renderer DLNA su cui si trasmette QUESTO contenuto. */
    private val _dlnaConnected = MutableStateFlow<DlnaRenderer?>(null)
    val dlnaConnected: StateFlow<DlnaRenderer?> = _dlnaConnected.asStateFlow()

    /** Renderer Streamo su cui si trasmette QUESTO contenuto. */
    private val _streamoConnected = MutableStateFlow<StreamoRenderer?>(null)
    val streamoConnected: StateFlow<StreamoRenderer?> = _streamoConnected.asStateFlow()

    /** True se questo contenuto è in cast (DLNA o Streamo). */
    val isCastActive: Boolean get() = _dlnaConnected.value != null || _streamoConnected.value != null

    private fun castMatchesThis(s: CastSession?): Boolean =
        s != null && s.media.tmdbId == tmdbId && s.media.mediaType == mediaType &&
            s.media.season == season && s.media.episode == episode

    private fun buildCastMedia() = CastMedia(
        tmdbId = tmdbId, mediaType = mediaType, season = season, episode = episode,
        title = title, poster = poster, releaseDate = releaseDate, displayTitle = displayTitle()
    )

    fun discoverDlna() = castController.discover()

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

    /** Avvia la trasmissione del contenuto corrente sul renderer e pausa il player locale. */
    fun castToDlna(renderer: DlnaRenderer, forceStreaming: Boolean = false) {
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
                    castController.start(renderer, src.playlistUrl, src.headers, buildCastMedia(), pos)
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
        player.pause()
        castController.start(renderer, url, currentHeaders, buildCastMedia(), pos)
    }

    /** Avvia la trasmissione Streamo (HTTP → app Streamo sulla TV). */
    fun castToStreamo(renderer: StreamoRenderer) {
        viewModelScope.launch {
            val pos = player.currentPosition.coerceAtLeast(0L)
            player.pause()
            _loading.value = true
            _error.value = null
            val ok = castController.startStreamo(renderer, buildCastMedia(), pos)
            _loading.value = false
            if (!ok) {
                _error.value = "Impossibile connettersi alla TV Streamo " +
                    "(${renderer.host}:${renderer.port}). Verifica che l'app Streamo sia " +
                    "aperta sulla TV e sulla stessa rete."
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

    private val _seekingManually = MutableStateFlow(false)
    val seekingManually: StateFlow<Boolean> = _seekingManually.asStateFlow()

    private val _playbackEnded = MutableStateFlow(false)
    val playbackEnded: StateFlow<Boolean> = _playbackEnded.asStateFlow()

    /** Riproduzione offline (file in cache locale): non trasmettibile, il TV non lo raggiunge. */
    private val _isOfflinePlayback = MutableStateFlow(false)
    val isOfflinePlayback: StateFlow<Boolean> = _isOfflinePlayback.asStateFlow()

    private val _currentSeason = MutableStateFlow(season)
    val currentSeason: StateFlow<Int> = _currentSeason.asStateFlow()

    private val _currentEpisode = MutableStateFlow(episode)
    val currentEpisode: StateFlow<Int> = _currentEpisode.asStateFlow()

    /** Episode name (TV only) shown under the series title; null/blank if unknown. */
    private val _episodeTitle = MutableStateFlow<String?>(null)
    val episodeTitle: StateFlow<String?> = _episodeTitle.asStateFlow()

    /** Ordered CDN mirrors of the same vixcloud embed; we fall through them on failure. */
    private var playbackSources: List<PlaybackSource> = emptyList()
    private var sourceIndex = 0
    private var pendingResumePositionMs: Long = 0

    private var tmdbItem: TmdbItem? = null

    init {
        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                _buffering.value = state == Player.STATE_BUFFERING
                if (state == Player.STATE_READY) {
                    _duration.value = player.duration.coerceAtLeast(0L)
                    _loading.value = false
                    refreshAvailableTracks()
                    // Resume from saved position
                    if (pendingResumePositionMs > 0) {
                        player.seekTo(pendingResumePositionMs)
                        pendingResumePositionMs = 0
                    }
                    // Resume playback after manual seek once decoder is ready
                    // (Overlay is cleared by the fixed delay in seekTo, not here,
                    // to avoid showing the first decoded frame which can be corrupted.)
                    if (!_seekingManually.value && !player.isPlaying) {
                        player.play()
                    }
                }
                if (state == Player.STATE_ENDED) {
                    _playbackEnded.value = true
                    onPlaybackEnded()
                }
            }

            override fun onTracksChanged(tracks: androidx.media3.common.Tracks) {
                refreshAvailableTracks()
            }

            override fun onIsPlayingChanged(playing: Boolean) {
                // In trasmissione lo stato play arriva dal CastController, non dal locale.
                if (_dlnaConnected.value == null && _streamoConnected.value == null) _isPlaying.value = playing
            }

            override fun onPlayerError(e: PlaybackException) {
                // This mirror failed — fall through to the next server
                advanceToNextSource()
            }
        })

        // Posizione locale (solo quando NON stiamo trasmettendo questo contenuto).
        viewModelScope.launch {
            while (true) {
                if (_dlnaConnected.value == null && _streamoConnected.value == null) {
                    _currentPosition.value = player.currentPosition.coerceAtLeast(0L)
                    _bufferedPosition.value = player.bufferedPosition.coerceAtLeast(0L)
                }
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
                            _streamoConnected.value = null
                        }
                        is CastSession.Streamo -> {
                            _streamoConnected.value = s.renderer
                            _dlnaConnected.value = null
                        }
                        null -> {
                            _dlnaConnected.value = null
                            _streamoConnected.value = null
                        }
                    }
                } else {
                    _dlnaConnected.value = null
                    _streamoConnected.value = null
                }
            }
        }
        viewModelScope.launch {
            castController.position.collect {
                if (_dlnaConnected.value != null || _streamoConnected.value != null) _currentPosition.value = it
            }
        }
        viewModelScope.launch {
            castController.duration.collect {
                if ((_dlnaConnected.value != null || _streamoConnected.value != null) && it > 0) _duration.value = it
            }
        }
        viewModelScope.launch {
            castController.isPlaying.collect {
                if (_dlnaConnected.value != null || _streamoConnected.value != null) _isPlaying.value = it
            }
        }

        // Riaggancio: se il CastController trasmette già questo contenuto non caricare il
        // locale (la trasmissione è in corso); altrimenti avvia normalmente.
        if (castMatchesThis(castController.session.value)) {
            val s = castController.session.value
            when (s) {
                is CastSession.Dlna -> _dlnaConnected.value = s.renderer
                is CastSession.Streamo -> _streamoConnected.value = s.renderer
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
                    playStreamFromUrl(downloadEntry.streamUrl, emptyMap(), forceOffline = true)
                    checkNextEpisode()
                    return@launch
                }

                // Online playback → pause downloads to preserve bandwidth.
                pauseDownloadsForStreaming()

                // Online: resolve stream URL via the provider pipeline
                val resolution = if (mediaType == "tv" && season > 0) {
                    resolver.episodeSource(tmdbId, title, releaseDate, season, episode)
                } else {
                    resolver.movieSource(tmdbId, title, releaseDate)
                }

                if (resolution.sources.isEmpty()) {
                    _error.value = resolution.message ?: "Titolo non disponibile"
                    _debugLogs.value = ProviderDebugLogger.getLogs()
                    _loading.value = false
                    return@launch
                }

                playbackSources = resolution.sources
                sourceIndex = 0
                _sources.value = resolution.sources
                loadCurrentSource()
                checkNextEpisode()

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
                _error.value = e.localizedMessage ?: "Errore sconosciuto"
                _debugLogs.value = ProviderDebugLogger.getLogs()
                _loading.value = false
            }
        }
    }

    private fun loadCurrentSource() {
        if (sourceIndex >= playbackSources.size) {
            _error.value = "Riproduzione non disponibile"
            _loading.value = false
            return
        }
        val source = playbackSources[sourceIndex]
        _currentSourceIndex.value = sourceIndex
        playStreamFromUrl(source.playlistUrl, source.headers)
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

    private fun playStreamFromUrl(url: String, headers: Map<String, String>, forceOffline: Boolean = false) {
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
            // Build an upstream DataSource.Factory with vixcloud headers
            val upstreamFactory = DefaultHttpDataSource.Factory()
            if (headers.isNotEmpty()) {
                upstreamFactory.setDefaultRequestProperties(headers)
            }

            // Use CacheDataSource.Factory: cached segments are served from disk,
            // network requests fall through to the upstream factory.
            CacheDataSource.Factory()
                .setCache(DownloadInfrastructure.cache)
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
        player.setMediaSource(mediaSource)
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
        playStreamFromUrl(source.playlistUrl, source.headers)
        player.seekTo(pos)
    }

    fun setPlaybackSpeed(speed: Float) {
        player.setPlaybackSpeed(speed)
        _playbackSpeed.value = speed
    }

    private var isSeeking = false

    private fun performSeek(action: () -> Unit) {
        if (isSeeking) return
        isSeeking = true
        action()
        viewModelScope.launch {
            delay(200)
            isSeeking = false
        }
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

    fun seekTo(positionMs: Long) {
        // Cast: il seek lo esegue il dispositivo remoto (debounce gestito dal CastController).
        if (isCastActive) {
            castController.seekTo(positionMs)
            return
        }
        if (isSeeking) return
        isSeeking = true
        _seekingManually.value = true
        val wasPlaying = player.isPlaying
        player.pause()
        player.seekTo(positionMs)
        viewModelScope.launch {
            delay(250)
            _seekingManually.value = false
            isSeeking = false
            if (wasPlaying) player.play()
        }
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

    private fun checkNextEpisode() {
        val item = tmdbItem ?: return
        _nextEpisodeAvailable.value = TVLogic.nextEpisode(item, season, episode) != null
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
                    posterPath = poster
                )
            )
            repository.addToHistory(
                HistoryEntry(
                    tmdbId = tmdbId,
                    mediaType = mediaType,
                    title = title,
                    posterPath = poster,
                    season = season,
                    episode = episode
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

            val autoplay = settings.autoplayNext.first()
            if (autoplay && _nextEpisodeAvailable.value) {
                playNextEpisode()
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
                    posterPath = poster
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
                        episode = episode
                    )
                )
            }
        }
    }

    /**
     * Salva un progress entry per contenuto esterno (es. comando cast Streamo),
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

        // Resume the downloads we paused for streaming. enqueue() is synchronous, so it
        // is safe here even though viewModelScope is already cancelled. The worker resets
        // its own status when it runs.
        if (didPauseForStreaming) {
            DownloadGate.streamingActive.set(false)
            pausedForStreamingIds.forEach { ResolveAndDownloadWorker.enqueue(appContext, it) }
        }

        super.onCleared()
    }
}