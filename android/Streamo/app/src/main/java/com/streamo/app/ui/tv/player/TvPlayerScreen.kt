package com.streamo.app.ui.tv.player

import android.view.KeyEvent
import android.view.LayoutInflater
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AspectRatio
import androidx.compose.material.icons.filled.Audiotrack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.ClosedCaption
import androidx.compose.material.icons.filled.ClosedCaptionOff
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Forward10
import androidx.compose.material.icons.filled.HighQuality
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay
import androidx.compose.material.icons.filled.Replay10
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.streamo.app.player.streamo.StreamoCastReceiver
import com.streamo.app.player.streamo.StreamoCommand
import com.streamo.app.player.streamo.StreamoStatus
import com.streamo.app.ui.player.PlayerViewModel
import com.streamo.app.ui.tv.common.TvFocusable
import com.streamo.app.util.Format
import kotlinx.coroutines.delay

/**
 * TV Player screen. Reuses [PlayerViewModel] unchanged — feature parity with the
 * phone player (subtitles, audio track, video quality, playback speed, aspect ratio,
 * server selection) but navigated entirely with the D-pad.
 *
 * Two interaction modes:
 * - **Controls hidden** (immersive viewing): the root Box owns focus and intercepts
 *   D-pad keys directly — Center toggles play/pause, Left/Right scrub ±10s, any key
 *   reveals the controls. This keeps the common case (just watching) one-button simple.
 * - **Controls visible**: the root stops intercepting so focus moves between real
 *   focusable buttons (transport row, top-bar subtitle/settings, next-episode pill).
 *   Any key press resets the 4s auto-hide timer.
 *
 * The settings overlay mirrors the phone's panel: a main list that drills into
 * sub-panels, every row a [TvFocusable]. Back steps out of a sub-panel, then closes.
 *
 * Drops vs phone: PiP, DLNA cast, forced landscape, touch Slider/scrubber.
 *
 * @param onNavigateToPlayer chiamata quando arriva un comando di play dal telefono
 *   (Streamo cast): tmdbId, mediaType, season, episode, title, poster, releaseDate.
 */
@OptIn(UnstableApi::class)
@Composable
fun TvPlayerScreen(
    onBack: () -> Unit = {},
    onNavigateToPlayer: (Int, String, Int, Int, String, String?, String?) -> Unit = { _, _, _, _, _, _, _ -> },
    viewModel: PlayerViewModel = hiltViewModel()
) {
    val isPlaying by viewModel.isPlaying.collectAsState()
    val currentPosition by viewModel.currentPosition.collectAsState()
    val duration by viewModel.duration.collectAsState()
    val bufferedPosition by viewModel.bufferedPosition.collectAsState()
    val buffering by viewModel.buffering.collectAsState()
    val loading by viewModel.loading.collectAsState()
    val error by viewModel.error.collectAsState()
    val playbackEnded by viewModel.playbackEnded.collectAsState()
    val nextAvailable by viewModel.nextEpisodeAvailable.collectAsState()

    val audioTracks by viewModel.audioTracks.collectAsState()
    val subtitleTracks by viewModel.subtitleTracks.collectAsState()
    val videoTracks by viewModel.videoTracks.collectAsState()
    val selectedAudio by viewModel.selectedAudio.collectAsState()
    val selectedSubtitle by viewModel.selectedSubtitle.collectAsState()
    val selectedVideoQuality by viewModel.selectedVideoQuality.collectAsState()
    val playbackSpeed by viewModel.playbackSpeed.collectAsState()
    val sources by viewModel.sources.collectAsState()
    val currentSourceIndex by viewModel.currentSourceIndex.collectAsState()
    val currentSeason by viewModel.currentSeason.collectAsState()
    val currentEpisode by viewModel.currentEpisode.collectAsState()
    val episodeTitle by viewModel.episodeTitle.collectAsState()

    var controlsVisible by remember { mutableStateOf(true) }
    var showSettings by remember { mutableStateOf(false) }
    // null = main list; "subtitles"/"audio"/"speed"/"quality"/"aspect"/"server" = sub-panel
    var settingsPanel by remember { mutableStateOf<String?>(null) }
    var resizeMode by remember { mutableIntStateOf(AspectRatioFrameLayout.RESIZE_MODE_FIT) }
    // Bumped on every key press while controls are visible, to reset the auto-hide timer.
    var interactionTick by remember { mutableIntStateOf(0) }

    val rootFocus = remember { FocusRequester() }
    val playPauseFocus = remember { FocusRequester() }
    val settingsFocus = remember { FocusRequester() }

    // Auto-hide controls after 4s while playing, unless the settings overlay is open.
    LaunchedEffect(isPlaying, controlsVisible, showSettings, interactionTick, buffering, playbackEnded) {
        if (controlsVisible && isPlaying && !showSettings && !buffering && !playbackEnded) {
            delay(4000)
            controlsVisible = false
        }
    }

    // Keep the relevant element focused: settings list when open, play/pause when the
    // controls are showing, the root key-catcher when immersive.
    LaunchedEffect(controlsVisible, showSettings, settingsPanel) {
        runCatching {
            when {
                showSettings -> settingsFocus.requestFocus()
                controlsVisible -> playPauseFocus.requestFocus()
                else -> rootFocus.requestFocus()
            }
        }
    }

    // Refresh tracks whenever the settings overlay opens (mirrors phone behaviour).
    LaunchedEffect(showSettings) {
        if (showSettings) viewModel.refreshAvailableTracks()
    }

    LaunchedEffect(playbackEnded) {
        if (playbackEnded) controlsVisible = true
    }

    // Keep screen on while in the player; clear it and persist progress on exit.
    val context = LocalContext.current
    DisposableEffect(Unit) {
        val window = (context as? android.app.Activity)?.window
        window?.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose {
            window?.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            viewModel.saveCurrentProgress()
            // Segnala al telefono che la TV non sta più riproducendo, così la sua sessione
            // cast termina (il polling /status vedrebbe altrimenti uno stato congelato).
            StreamoCastReceiver.updateStatus(
                StreamoStatus(
                    status = "stopped",
                    positionMs = 0,
                    durationMs = 0,
                    title = null,
                    tmdbId = null,
                    mediaType = null
                )
            )
        }
    }

    // Ricezione comandi Streamo cast dal telefono (transport mentre il player è aperto;
    // i Play quando la TV è ferma li gestisce il consumer globale in TvRootView).
    LaunchedEffect(Unit) {
        StreamoCastReceiver.commands.collect { cmd ->
            when (cmd) {
                is StreamoCommand.Play -> {
                    viewModel.saveCurrentProgress()
                    // Salva un progress entry con la posizione di partenza desiderata,
                    // così il nuovo PlayerViewModel lo riprende automaticamente.
                    if (cmd.startPositionMs > 0) {
                        viewModel.saveExternalStartPosition(
                            cmd.tmdbId, cmd.mediaType, cmd.season, cmd.episode,
                            cmd.startPositionMs, cmd.title, cmd.posterUrl
                        )
                    }
                    onBack()
                    onNavigateToPlayer(
                        cmd.tmdbId, cmd.mediaType, cmd.season, cmd.episode,
                        cmd.title, cmd.posterUrl, cmd.releaseDate
                    )
                }
                is StreamoCommand.Pause -> viewModel.player.pause()
                is StreamoCommand.Resume -> viewModel.player.play()
                is StreamoCommand.Stop -> onBack()
                is StreamoCommand.Seek -> viewModel.player.seekTo(cmd.positionMs)
            }
        }
    }

    // Reporta stato riproduzione al server Streamo.
    LaunchedEffect(isPlaying, currentPosition, duration) {
        StreamoCastReceiver.updateStatus(
            StreamoStatus(
                status = when {
                    loading || buffering -> "loading"
                    playbackEnded -> "stopped"
                    isPlaying -> "playing"
                    else -> "paused"
                },
                positionMs = currentPosition,
                durationMs = duration,
                title = viewModel.title,
                tmdbId = viewModel.tmdbId,
                mediaType = viewModel.mediaType
            )
        )
    }

    // Back navigation, layered by state (only one handler enabled at a time).
    BackHandler(enabled = showSettings && settingsPanel != null) { settingsPanel = null }
    BackHandler(enabled = showSettings && settingsPanel == null) { showSettings = false }
    BackHandler(enabled = !showSettings && controlsVisible) { controlsVisible = false }
    BackHandler(enabled = !showSettings && !controlsVisible) {
        viewModel.saveCurrentProgress()
        onBack()
    }

    val reveal: () -> Unit = { controlsVisible = true }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .focusRequester(rootFocus)
            .focusable()
            .onPreviewKeyEvent { event ->
                if (event.nativeKeyEvent.action != KeyEvent.ACTION_DOWN) return@onPreviewKeyEvent false
                // Controls visible / settings open: let the focus system navigate, just
                // keep the controls awake by resetting the auto-hide timer.
                if (controlsVisible || showSettings) {
                    interactionTick++
                    return@onPreviewKeyEvent false
                }
                // Immersive mode: Left/Right scrub ±10s WITHOUT revealing the controls,
                // so the user can keep skipping. Center/Up/Down open the overlay.
                when (event.nativeKeyEvent.keyCode) {
                    KeyEvent.KEYCODE_DPAD_RIGHT,
                    KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> {
                        viewModel.seekForward(); true
                    }
                    KeyEvent.KEYCODE_DPAD_LEFT,
                    KeyEvent.KEYCODE_MEDIA_REWIND -> {
                        viewModel.seekBack(); true
                    }
                    KeyEvent.KEYCODE_DPAD_CENTER,
                    KeyEvent.KEYCODE_ENTER,
                    KeyEvent.KEYCODE_DPAD_UP,
                    KeyEvent.KEYCODE_DPAD_DOWN -> {
                        reveal(); true
                    }
                    // Dedicated play/pause key stays a toggle even while immersive.
                    KeyEvent.KEYCODE_SPACE,
                    KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                        viewModel.togglePlayPause(); true
                    }
                    else -> false
                }
            }
    ) {
        // PlayerView — useController=false (custom overlay), non-focusable so it never
        // steals the D-pad from the root key-catcher / controls.
        AndroidView(
            factory = { ctx ->
                val playerView = LayoutInflater.from(ctx)
                    .inflate(com.streamo.app.R.layout.view_player, null) as PlayerView
                playerView.player = viewModel.player
                playerView.useController = false
                playerView.isFocusable = false
                playerView.isFocusableInTouchMode = false
                playerView
            },
            update = { it.resizeMode = resizeMode },
            modifier = Modifier.fillMaxSize()
        )

        // Buffering / loading spinner.
        if (buffering || loading) {
            CircularProgressIndicator(
                modifier = Modifier.align(Alignment.Center),
                color = Color.White
            )
        }

        // Error overlay.
        error?.let { errorMsg ->
            Column(
                modifier = Modifier
                    .align(Alignment.Center)
                    .padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = errorMsg,
                    color = Color.White,
                    style = MaterialTheme.typography.bodyLarge
                )
            }
        }

        // Controls overlay.
        AnimatedVisibility(
            visible = controlsVisible && !showSettings && error == null,
            enter = fadeIn(tween(200)),
            exit = fadeOut(tween(200))
        ) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.45f))
            ) {
                // Top bar: title + episode line, with subtitle toggle & settings buttons.
                Column(
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .fillMaxWidth()
                        .padding(horizontal = 48.dp, vertical = 28.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = viewModel.title,
                                color = Color.White,
                                fontWeight = FontWeight.Bold,
                                fontSize = 22.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            if (viewModel.mediaType == "tv" && currentSeason > 0) {
                                val epLine = "S${currentSeason} E${currentEpisode}" +
                                    (episodeTitle?.takeIf { it.isNotBlank() }?.let { " - $it" } ?: "")
                                Text(
                                    text = epLine,
                                    color = Color.White.copy(alpha = 0.6f),
                                    fontSize = 14.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.padding(top = 2.dp)
                                )
                            }
                        }
                        if (subtitleTracks.isNotEmpty()) {
                            val subtitlesOn = selectedSubtitle != null
                            TvCircleButton(
                                icon = if (subtitlesOn) Icons.Filled.ClosedCaption else Icons.Filled.ClosedCaptionOff,
                                contentDescription = if (subtitlesOn) "Disabilita sottotitoli" else "Abilita sottotitoli",
                                size = 44.dp,
                                onClick = { viewModel.toggleSubtitles() }
                            )
                            Spacer(modifier = Modifier.width(12.dp))
                        }
                        TvCircleButton(
                            icon = Icons.Filled.Settings,
                            contentDescription = "Impostazioni",
                            size = 44.dp,
                            onClick = { settingsPanel = null; showSettings = true }
                        )
                    }
                }

                // Center transport row, or replay button once playback ended.
                if (playbackEnded) {
                    TvCircleButton(
                        icon = Icons.Filled.Replay,
                        contentDescription = "Riproduci dall'inizio",
                        size = 88.dp,
                        iconSize = 44.dp,
                        focusRequester = playPauseFocus,
                        modifier = Modifier.align(Alignment.Center),
                        onClick = { viewModel.replay() }
                    )
                } else {
                    Row(
                        modifier = Modifier.align(Alignment.Center),
                        horizontalArrangement = Arrangement.spacedBy(32.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        TvCircleButton(
                            icon = Icons.Filled.Replay10,
                            contentDescription = "Indietro di 10 secondi",
                            size = 64.dp,
                            iconSize = 38.dp,
                            onClick = { viewModel.seekBack() }
                        )
                        TvCircleButton(
                            icon = if (isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                            contentDescription = if (isPlaying) "Pausa" else "Riproduci",
                            size = 88.dp,
                            iconSize = 48.dp,
                            focusRequester = playPauseFocus,
                            onClick = { viewModel.togglePlayPause() }
                        )
                        TvCircleButton(
                            icon = Icons.Filled.Forward10,
                            contentDescription = "Avanti di 10 secondi",
                            size = 64.dp,
                            iconSize = 38.dp,
                            onClick = { viewModel.seekForward() }
                        )
                    }
                }

                // Bottom: focusable seek bar. When focused, Left/Right scrub ±10s.
                TvSeekBar(
                    positionMs = currentPosition,
                    durationMs = duration,
                    bufferedMs = bufferedPosition,
                    onSeekBack = { viewModel.seekBack() },
                    onSeekForward = { viewModel.seekForward() },
                    onInteract = { interactionTick++ },
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .padding(horizontal = 48.dp, vertical = 32.dp)
                )

                // Next-episode pill (TV series, near the end / once ended).
                val progressFraction = if (duration > 0) currentPosition.toFloat() / duration else 0f
                if (nextAvailable && (playbackEnded || progressFraction >= 0.95f)) {
                    TvFocusable(
                        onClick = { viewModel.playNextEpisode() },
                        modifier = Modifier
                            .align(Alignment.BottomEnd)
                            .padding(bottom = 96.dp, end = 48.dp)
                    ) { focused ->
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier
                                .clip(RoundedCornerShape(50))
                                .background(
                                    if (focused) Color.White else Color.Black.copy(alpha = 0.65f)
                                )
                                .border(
                                    1.dp,
                                    Color.White.copy(alpha = 0.25f),
                                    RoundedCornerShape(50)
                                )
                                .padding(horizontal = 18.dp, vertical = 10.dp)
                        ) {
                            Text(
                                "Prossimo episodio",
                                color = if (focused) Color.Black else Color.White,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Medium
                            )
                            Icon(
                                Icons.Filled.SkipNext,
                                contentDescription = null,
                                tint = if (focused) Color.Black else Color.White,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }
                }
            }
        }

        // Settings overlay — full feature parity with the phone player.
        if (showSettings) {
            TvSettingsOverlay(
                panel = settingsPanel,
                firstRowFocus = settingsFocus,
                subtitleTracks = subtitleTracks,
                audioTracks = audioTracks,
                videoTracks = videoTracks,
                sources = sources,
                selectedSubtitle = selectedSubtitle,
                selectedAudio = selectedAudio,
                selectedVideoQuality = selectedVideoQuality,
                playbackSpeed = playbackSpeed,
                resizeMode = resizeMode,
                currentSourceIndex = currentSourceIndex,
                onOpenPanel = { settingsPanel = it },
                onSelectSubtitleOff = { viewModel.disableSubtitles(); settingsPanel = null },
                onSelectSubtitle = { viewModel.selectSubtitleTrack(it); settingsPanel = null },
                onSelectAudio = { viewModel.selectAudioTrack(it); settingsPanel = null },
                onSelectSpeed = { viewModel.setPlaybackSpeed(it); settingsPanel = null },
                onSelectAutoQuality = { viewModel.setAutoVideoQuality(); settingsPanel = null },
                onSelectQuality = { viewModel.selectVideoQuality(it); settingsPanel = null },
                onSelectAspect = { resizeMode = it; settingsPanel = null },
                onSelectSource = { viewModel.selectSource(it); settingsPanel = null }
            )
        }
    }
}

private fun speedLabel(s: Float): String = when {
    s == 1f -> "Normale"
    s == s.toInt().toFloat() -> "${s.toInt()}x"
    else -> "${s}x"
}

private fun aspectLabel(mode: Int): String =
    if (mode == AspectRatioFrameLayout.RESIZE_MODE_ZOOM) "Riempi schermo" else "Adatta"

/**
 * Focusable seek bar for the remote. When focused (white thumb + thicker track),
 * Left/Right scrub ±10s via [onSeekBack]/[onSeekForward]; Up/Down fall through so the
 * focus system can move to the transport row. [onInteract] keeps the controls awake.
 */
@Composable
private fun TvSeekBar(
    positionMs: Long,
    durationMs: Long,
    bufferedMs: Long,
    onSeekBack: () -> Unit,
    onSeekForward: () -> Unit,
    onInteract: () -> Unit,
    modifier: Modifier = Modifier
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val primary = MaterialTheme.colorScheme.primary
    Column(
        modifier = modifier
            .onPreviewKeyEvent { event ->
                if (event.nativeKeyEvent.action != KeyEvent.ACTION_DOWN) return@onPreviewKeyEvent false
                when (event.nativeKeyEvent.keyCode) {
                    KeyEvent.KEYCODE_DPAD_RIGHT,
                    KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> { onSeekForward(); onInteract(); true }
                    KeyEvent.KEYCODE_DPAD_LEFT,
                    KeyEvent.KEYCODE_MEDIA_REWIND -> { onSeekBack(); onInteract(); true }
                    else -> false
                }
            }
            .focusable(interactionSource = interaction)
    ) {
        val progressFraction =
            if (durationMs > 0L) (positionMs.toFloat() / durationMs).coerceIn(0f, 1f) else 0f
        val bufferedFraction =
            if (durationMs > 0L) (bufferedMs.toFloat() / durationMs).coerceIn(0f, 1f) else 0f
        val trackHeight = if (focused) 6.dp else 4.dp
        Canvas(modifier = Modifier.fillMaxWidth().height(16.dp)) {
            val y = size.height / 2f
            val h = trackHeight.toPx()
            // remaining
            drawRect(
                color = Color.White.copy(alpha = 0.3f),
                topLeft = Offset(0f, y - h / 2f),
                size = Size(size.width, h)
            )
            // buffered
            if (bufferedFraction > 0f) {
                drawRect(
                    color = Color.White.copy(alpha = 0.55f),
                    topLeft = Offset(0f, y - h / 2f),
                    size = Size(size.width * bufferedFraction, h)
                )
            }
            // played
            drawRect(
                color = primary,
                topLeft = Offset(0f, y - h / 2f),
                size = Size(size.width * progressFraction, h)
            )
            // thumb (only when focused, so it reads as the active scrubbing element)
            if (focused) {
                drawCircle(
                    color = Color.White,
                    radius = 9.dp.toPx(),
                    center = Offset(size.width * progressFraction, y)
                )
            }
        }
        Spacer(modifier = Modifier.height(8.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(Format.time(positionMs / 1000.0), color = Color.White, fontSize = 13.sp)
            Text(Format.time(durationMs / 1000.0), color = Color.White, fontSize = 13.sp)
        }
    }
}

/** Round icon button with a TV focus highlight (filled white circle when focused). */
@Composable
private fun TvCircleButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: androidx.compose.ui.unit.Dp = 48.dp,
    iconSize: androidx.compose.ui.unit.Dp = 28.dp,
    focusRequester: FocusRequester? = null
) {
    TvFocusable(
        onClick = onClick,
        modifier = modifier,
        focusRequester = focusRequester,
        scaleOnFocus = 1.12f
    ) { focused ->
        Box(
            modifier = Modifier
                .size(size)
                .clip(RoundedCornerShape(percent = 50))
                .background(if (focused) Color.White else Color.Black.copy(alpha = 0.4f)),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = icon,
                contentDescription = contentDescription,
                tint = if (focused) Color.Black else Color.White,
                modifier = Modifier.size(iconSize)
            )
        }
    }
}

@Composable
private fun TvSettingsOverlay(
    panel: String?,
    firstRowFocus: FocusRequester,
    subtitleTracks: List<PlayerViewModel.TrackInfo>,
    audioTracks: List<PlayerViewModel.TrackInfo>,
    videoTracks: List<PlayerViewModel.TrackInfo>,
    sources: List<com.streamo.app.provider.PlaybackSource>,
    selectedSubtitle: PlayerViewModel.TrackInfo?,
    selectedAudio: PlayerViewModel.TrackInfo?,
    selectedVideoQuality: PlayerViewModel.TrackInfo?,
    playbackSpeed: Float,
    resizeMode: Int,
    currentSourceIndex: Int,
    onOpenPanel: (String) -> Unit,
    onSelectSubtitleOff: () -> Unit,
    onSelectSubtitle: (PlayerViewModel.TrackInfo) -> Unit,
    onSelectAudio: (PlayerViewModel.TrackInfo) -> Unit,
    onSelectSpeed: (Float) -> Unit,
    onSelectAutoQuality: () -> Unit,
    onSelectQuality: (PlayerViewModel.TrackInfo) -> Unit,
    onSelectAspect: (Int) -> Unit,
    onSelectSource: (com.streamo.app.provider.PlaybackSource) -> Unit
) {
    val speedOptions = listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f)
    val aspectOptions = listOf(
        AspectRatioFrameLayout.RESIZE_MODE_FIT to "Adatta",
        AspectRatioFrameLayout.RESIZE_MODE_ZOOM to "Riempi schermo"
    )

    // Right-aligned panel so the dimmed video stays visible — typical TV settings drawer.
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.5f)),
        contentAlignment = Alignment.CenterEnd
    ) {
        Surface(
            shape = RoundedCornerShape(20.dp),
            color = Color(0xFF1E1E20),
            modifier = Modifier
                .padding(end = 48.dp)
                .width(440.dp)
        ) {
            Column(
                modifier = Modifier
                    .padding(vertical = 16.dp)
                    .heightIn(max = 520.dp)
            ) {
                val title = when (panel) {
                    "subtitles" -> "Sottotitoli"
                    "audio" -> "Audio"
                    "speed" -> "Velocità di riproduzione"
                    "quality" -> "Qualità video"
                    "aspect" -> "Formato video"
                    "server" -> "Selezione server"
                    else -> "Impostazioni"
                }
                Text(
                    text = title,
                    color = Color.White,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp)
                )
                Column(
                    modifier = Modifier.verticalScroll(rememberScrollState())
                ) {
                    when (panel) {
                        "subtitles" -> {
                            TvOptionRow("Disattivati", selectedSubtitle == null, firstRowFocus, onSelectSubtitleOff)
                            subtitleTracks.forEach { track ->
                                TvOptionRow(
                                    track.label.takeIf { it.isNotBlank() } ?: "Sottotitoli",
                                    selectedSubtitle?.uniqueId == track.uniqueId
                                ) { onSelectSubtitle(track) }
                            }
                        }
                        "audio" -> {
                            audioTracks.forEachIndexed { i, track ->
                                TvOptionRow(
                                    track.label.takeIf { it.isNotBlank() } ?: "Traccia audio",
                                    selectedAudio?.uniqueId == track.uniqueId,
                                    if (i == 0) firstRowFocus else null
                                ) { onSelectAudio(track) }
                            }
                        }
                        "speed" -> {
                            speedOptions.forEachIndexed { i, s ->
                                TvOptionRow(
                                    speedLabel(s), playbackSpeed == s,
                                    if (i == 0) firstRowFocus else null
                                ) { onSelectSpeed(s) }
                            }
                        }
                        "quality" -> {
                            TvOptionRow("Auto", selectedVideoQuality == null, firstRowFocus, onSelectAutoQuality)
                            videoTracks.forEach { track ->
                                TvOptionRow(
                                    track.label,
                                    selectedVideoQuality?.formatId == track.formatId
                                ) { onSelectQuality(track) }
                            }
                        }
                        "aspect" -> {
                            aspectOptions.forEachIndexed { i, (mode, label) ->
                                TvOptionRow(
                                    label, resizeMode == mode,
                                    if (i == 0) firstRowFocus else null
                                ) { onSelectAspect(mode) }
                            }
                        }
                        "server" -> {
                            sources.forEachIndexed { index, src ->
                                TvOptionRow(
                                    "Server ${index + 1}", currentSourceIndex == index,
                                    if (index == 0) firstRowFocus else null
                                ) { onSelectSource(src) }
                            }
                        }
                        else -> {
                            TvSettingsRow(
                                Icons.Filled.ClosedCaption, "Sottotitoli",
                                selectedSubtitle?.label?.takeIf { it.isNotBlank() } ?: "Disattivati",
                                subtitleTracks.isNotEmpty(), firstRowFocus
                            ) { onOpenPanel("subtitles") }
                            TvSettingsRow(
                                Icons.Filled.Audiotrack, "Audio",
                                selectedAudio?.label?.takeIf { it.isNotBlank() } ?: "—",
                                audioTracks.isNotEmpty()
                            ) { onOpenPanel("audio") }
                            TvSettingsRow(
                                Icons.Filled.Speed, "Velocità di riproduzione",
                                speedLabel(playbackSpeed), true
                            ) { onOpenPanel("speed") }
                            TvSettingsRow(
                                Icons.Filled.HighQuality, "Qualità video",
                                selectedVideoQuality?.label ?: "Auto",
                                videoTracks.size > 1
                            ) { onOpenPanel("quality") }
                            TvSettingsRow(
                                Icons.Filled.AspectRatio, "Formato video",
                                aspectLabel(resizeMode), true
                            ) { onOpenPanel("aspect") }
                            TvSettingsRow(
                                Icons.Filled.Dns, "Selezione server",
                                "Server ${currentSourceIndex + 1}", sources.size > 1
                            ) { onOpenPanel("server") }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TvSettingsRow(
    icon: ImageVector,
    label: String,
    value: String,
    enabled: Boolean,
    focusRequester: FocusRequester? = null,
    onClick: () -> Unit
) {
    TvFocusable(
        onClick = onClick,
        enabled = enabled,
        focusRequester = focusRequester,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 2.dp)
    ) { focused ->
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .background(if (focused) Color.White.copy(alpha = 0.14f) else Color.Transparent)
                .padding(horizontal = 16.dp, vertical = 14.dp)
        ) {
            Icon(
                icon, contentDescription = null,
                tint = if (enabled) Color.White else Color.White.copy(alpha = 0.4f),
                modifier = Modifier.size(22.dp)
            )
            Spacer(modifier = Modifier.width(18.dp))
            Text(
                text = label,
                color = if (enabled) Color.White else Color.White.copy(alpha = 0.4f),
                fontSize = 16.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                modifier = Modifier.weight(1f)
            )
            Text(text = value, color = Color.White.copy(alpha = 0.6f), fontSize = 14.sp, maxLines = 1)
            Spacer(modifier = Modifier.width(4.dp))
            Icon(
                Icons.Filled.ChevronRight, contentDescription = null,
                tint = Color.White.copy(alpha = 0.6f),
                modifier = Modifier.size(20.dp)
            )
        }
    }
}

@Composable
private fun TvOptionRow(
    label: String,
    selected: Boolean,
    focusRequester: FocusRequester? = null,
    onClick: () -> Unit
) {
    TvFocusable(
        onClick = onClick,
        focusRequester = focusRequester,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 2.dp)
    ) { focused ->
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .background(if (focused) Color.White.copy(alpha = 0.14f) else Color.Transparent)
                .padding(horizontal = 16.dp, vertical = 14.dp)
        ) {
            Box(modifier = Modifier.size(22.dp), contentAlignment = Alignment.Center) {
                if (selected) {
                    Icon(
                        Icons.Filled.Check, contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(20.dp)
                    )
                }
            }
            Spacer(modifier = Modifier.width(16.dp))
            Text(
                text = label,
                color = Color.White,
                fontSize = 16.sp,
                fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal
            )
        }
    }
}
