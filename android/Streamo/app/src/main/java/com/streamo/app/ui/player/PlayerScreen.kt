package com.streamo.app.ui.player

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.pm.ActivityInfo
import android.view.View
import android.view.WindowManager
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AspectRatio
import androidx.compose.material.icons.filled.HighQuality
import androidx.compose.material.icons.filled.Audiotrack
import androidx.compose.material.icons.filled.Cast
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.ClosedCaption
import androidx.compose.material.icons.filled.ClosedCaptionOff
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PictureInPictureAlt
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Forward10
import androidx.compose.material.icons.filled.Replay
import androidx.compose.material.icons.filled.Replay10
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import kotlinx.coroutines.delay
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.streamo.app.player.PipController
import com.streamo.app.util.Format

@OptIn(ExperimentalMaterial3Api::class)
@UnstableApi
@Composable
fun PlayerScreen(
    onBack: () -> Unit,
    onNextEpisode: () -> Unit = {}
) {
    val viewModel: PlayerViewModel = hiltViewModel()
    val context = LocalContext.current
    val view = LocalView.current

    val loading by viewModel.loading.collectAsState()
    val error by viewModel.error.collectAsState()
    val debugLogs by viewModel.debugLogs.collectAsState()
    val isPlaying by viewModel.isPlaying.collectAsState()
    val position by viewModel.currentPosition.collectAsState()
    val duration by viewModel.duration.collectAsState()
    val bufferedPosition by viewModel.bufferedPosition.collectAsState()
    val buffering by viewModel.buffering.collectAsState()
    val sources by viewModel.sources.collectAsState()
    val nextAvailable by viewModel.nextEpisodeAvailable.collectAsState()
    val seekingManually by viewModel.seekingManually.collectAsState()
    val playbackEnded by viewModel.playbackEnded.collectAsState()
    val audioTracks by viewModel.audioTracks.collectAsState()
    val subtitleTracks by viewModel.subtitleTracks.collectAsState()
    val selectedAudio by viewModel.selectedAudio.collectAsState()
    val selectedSubtitle by viewModel.selectedSubtitle.collectAsState()
    val videoTracks by viewModel.videoTracks.collectAsState()
    val selectedVideoQuality by viewModel.selectedVideoQuality.collectAsState()
    val playbackSpeed by viewModel.playbackSpeed.collectAsState()
    val currentSourceIndex by viewModel.currentSourceIndex.collectAsState()
    val currentSeason by viewModel.currentSeason.collectAsState()
    val currentEpisode by viewModel.currentEpisode.collectAsState()
    val episodeTitle by viewModel.episodeTitle.collectAsState()
    val isOfflinePlayback by viewModel.isOfflinePlayback.collectAsState()
    val dlnaRenderers by viewModel.dlnaRenderers.collectAsState()
    val dlnaScanning by viewModel.dlnaScanning.collectAsState()
    val dlnaConnected by viewModel.dlnaConnected.collectAsState()
    var showDlnaDialog by remember { mutableStateOf(false) }
    var showExitCastDialog by remember { mutableStateOf(false) }
    var showOfflineCastWarning by remember { mutableStateOf(false) }
    var pendingOfflineRenderer by remember { mutableStateOf<com.streamo.app.player.dlna.DlnaRenderer?>(null) }

    var controlsVisible by remember { mutableStateOf(true) }
    var settingsMenu by remember { mutableStateOf(false) }
    // null = lista principale; "subtitles"/"audio"/"speed"/"aspect"/"server" = sotto-pannello
    var settingsPanel by remember { mutableStateOf<String?>(null) }
    var resizeMode by remember { mutableIntStateOf(AspectRatioFrameLayout.RESIZE_MODE_FIT) }

    LaunchedEffect(controlsVisible, isPlaying, seekingManually, buffering, playbackEnded, settingsMenu) {
        if (controlsVisible && isPlaying && !seekingManually && !buffering && !playbackEnded && !settingsMenu) {
            delay(3000)
            controlsVisible = false
        }
    }

    LaunchedEffect(settingsMenu) {
        if (settingsMenu) {
            viewModel.refreshAvailableTracks()
        }
    }

    LaunchedEffect(playbackEnded) {
        if (playbackEnded) {
            controlsVisible = true
        }
    }
    var showDebug by remember { mutableStateOf(false) }
    var playerViewRef by remember { mutableStateOf<PlayerView?>(null) }
    // Snapshot of the last frame, painted over the player while seeking/buffering so
    // the screen never goes black. Captured from the TextureView right before a seek.
    var frozenFrame by remember { mutableStateOf<android.graphics.Bitmap?>(null) }
    // SurfaceView can't be read via getBitmap(); use PixelCopy (async) to grab the
    // currently displayed frame — including the correct crop, so no green edge.
    val captureFrame: () -> Unit = {
        val sv = playerViewRef?.videoSurfaceView as? android.view.SurfaceView
        if (sv != null && sv.width > 0 && sv.height > 0 && sv.holder.surface?.isValid == true) {
            val bmp = android.graphics.Bitmap.createBitmap(
                sv.width, sv.height, android.graphics.Bitmap.Config.ARGB_8888
            )
            try {
                android.view.PixelCopy.request(
                    sv, bmp,
                    { result ->
                        if (result == android.view.PixelCopy.SUCCESS) frozenFrame = bmp
                    },
                    android.os.Handler(android.os.Looper.getMainLooper())
                )
            } catch (_: Exception) { /* secure/invalid surface → black fallback */ }
        }
    }
    // Show the frozen frame whenever we'd otherwise see black: during a manual seek
    // (decoder flush) or while buffering the target position.
    val freezeVisible = (seekingManually || buffering) && !loading && error == null

    // Drop the frozen frame once playback is ready again (a fresh frame is rendered).
    LaunchedEffect(buffering, seekingManually) {
        if (!buffering && !seekingManually && frozenFrame != null) {
            delay(80)
            frozenFrame = null
        }
    }

    LaunchedEffect(Unit) {
        val window = (context as? Activity)?.window ?: return@LaunchedEffect
        val decorView = window.decorView
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, decorView).let { controller ->
            controller.hide(WindowInsetsCompat.Type.systemBars())
            controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        // Legacy immersive flags — must NOT include LAYOUT_* flags or the
        // bars will re-appear immediately under enableEdgeToEdge().
        @Suppress("DEPRECATION")
        decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        )
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        (context as? Activity)?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    }

    // Durante il cast il video è sulla TV: lascia spegnere lo schermo del telefono
    // (il proxy resta vivo via wake/wifi lock). In locale tieni lo schermo acceso.
    LaunchedEffect(dlnaConnected) {
        val window = (context as? Activity)?.window ?: return@LaunchedEffect
        if (dlnaConnected != null) {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            viewModel.saveCurrentProgress()
            val window = (context as? Activity)?.window
            val decorView = window?.decorView
            window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            (context as? Activity)?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            WindowCompat.setDecorFitsSystemWindows(window ?: return@onDispose, true)
            WindowInsetsControllerCompat(window ?: return@onDispose, decorView ?: return@onDispose).show(WindowInsetsCompat.Type.systemBars())
            @Suppress("DEPRECATION")
            decorView?.systemUiVisibility = View.SYSTEM_UI_FLAG_VISIBLE
        }
    }

    val activity = context as? android.app.Activity
    val enterPip: () -> Unit = {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O && activity != null) {
            val pipParams = android.app.PictureInPictureParams.Builder()
                .setAspectRatio(android.util.Rational(16, 9))
                .build()
            try {
                activity.enterPictureInPictureMode(pipParams)
            } catch (_: Exception) {
            }
        }
    }
    BackHandler {
        if (dlnaConnected != null) {
            // In trasmissione: chiedi se interrompere o continuare in background.
            showExitCastDialog = true
        } else if (viewModel.player.isPlaying && android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            enterPip()
        } else {
            onBack()
        }
    }

    // Hide the playback controls while the window is in Picture-in-Picture.
    val inPipMode by PipController.inPipMode.collectAsState()
    LaunchedEffect(inPipMode) {
        if (inPipMode) controlsVisible = false
    }

    Box(modifier = Modifier.fillMaxSize()) {
        AndroidView(
            factory = { ctx ->
                val pv = android.view.LayoutInflater.from(ctx)
                    .inflate(com.streamo.app.R.layout.view_player, null, false)
                    .findViewById<androidx.media3.ui.PlayerView>(com.streamo.app.R.id.player_view)
                playerViewRef = pv
                pv
            },
            update = { playerView ->
                playerView.player = viewModel.player
                playerView.resizeMode = resizeMode
                val subtitleView = playerView.findViewById<android.view.View>(androidx.media3.ui.R.id.exo_subtitles)
                subtitleView?.let { sv ->
                    val density = playerView.context.resources.displayMetrics.density
                    // Reparent the subtitle view out of the content frame
                    // (AspectRatioFrameLayout) and onto the PlayerView root. Inside the
                    // content frame it would scale/crop together with the video when the
                    // resize mode is ZOOM/FILL; as a direct child of the root it stays
                    // pinned full-screen and independent of the video scaling.
                    if (sv.parent !== playerView) {
                        (sv.parent as? android.view.ViewGroup)?.removeView(sv)
                        playerView.addView(
                            sv,
                            android.widget.FrameLayout.LayoutParams(
                                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                                android.widget.FrameLayout.LayoutParams.MATCH_PARENT
                            )
                        )
                    }
                    val lp = sv.layoutParams as? android.widget.FrameLayout.LayoutParams
                    lp?.bottomMargin = (32 * density).toInt()
                    sv.layoutParams = lp
                }
            },
            onRelease = { playerView ->
                playerView.player = null
            },
            modifier = Modifier.fillMaxSize()
        )

        // Freeze-frame overlay: keep the previous frame on screen while seeking or
        // buffering instead of going black. Also masks the corrupt (green) frame a
        // decoder flush can emit on seek. Falls back to black only if no frame was
        // captured (e.g. seeking before the first frame ever rendered).
        if (freezeVisible) {
            val bmp = frozenFrame
            if (bmp != null) {
                androidx.compose.foundation.Image(
                    bitmap = bmp.asImageBitmap(),
                    contentDescription = null,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Black)
                )
            } else {
                Box(modifier = Modifier.fillMaxSize().background(Color.Black))
            }
        }

        if (loading) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.6f)),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(
                    color = Color.White,
                    strokeWidth = 3.dp,
                    modifier = Modifier.size(48.dp)
                )
            }
        }

        error?.let { msg ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.8f))
                    .padding(24.dp),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = msg,
                        color = Color.White,
                        style = MaterialTheme.typography.titleMedium
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    TextButton(onClick = { viewModel.load() }) {
                        Text("Riprova", color = MaterialTheme.colorScheme.primary)
                    }
                    if (debugLogs.isNotBlank()) {
                        Spacer(modifier = Modifier.height(8.dp))
                        TextButton(onClick = { showDebug = !showDebug }) {
                            Text(
                                if (showDebug) "Nascondi log" else "Mostra log di debug",
                                color = MaterialTheme.colorScheme.secondary
                            )
                        }
                        if (showDebug) {
                            Spacer(modifier = Modifier.height(8.dp))
                            val scroll = rememberScrollState()
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .heightIn(max = 240.dp)
                                    .background(Color(0xFF1E1E1E), MaterialTheme.shapes.medium)
                                    .padding(12.dp)
                            ) {
                                SelectionContainer {
                                    Text(
                                        text = debugLogs,
                                        color = Color(0xFFB0B0B0),
                                        fontSize = 11.sp,
                                        lineHeight = 14.sp,
                                        modifier = Modifier.verticalScroll(scroll)
                                    )
                                }
                            }
                            Spacer(modifier = Modifier.height(8.dp))
                            val clipboard = LocalContext.current.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                            TextButton(onClick = {
                                clipboard.setPrimaryClip(ClipData.newPlainText("Provider debug logs", debugLogs))
                            }) {
                                Text("Copia log negli appunti", color = MaterialTheme.colorScheme.primary)
                            }
                        }
                    }
                }
            }
        }

        // Schermo scuro durante la trasmissione su TV: il video è sulla TV, qui mostriamo
        // solo lo stato. I controlli del player (toccando lo schermo) comandano la TV.
        if (dlnaConnected != null) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.padding(32.dp)
                ) {
                    Icon(
                        imageVector = Icons.Filled.Cast,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(64.dp)
                    )
                    Spacer(modifier = Modifier.height(20.dp))
                    val castTitle = if (viewModel.mediaType == "tv" && currentSeason > 0)
                        "${viewModel.title} · S${currentSeason}E${currentEpisode}"
                    else viewModel.title
                    Text(
                        text = castTitle,
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        fontSize = 20.sp,
                        textAlign = TextAlign.Center
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Trasmissione su ${dlnaConnected?.friendlyName ?: "TV"}",
                        color = MaterialTheme.colorScheme.primary,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium,
                        textAlign = TextAlign.Center
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(
                        text = "Usa i controlli del player per comandare la TV",
                        color = Color.White.copy(alpha = 0.6f),
                        fontSize = 13.sp,
                        textAlign = TextAlign.Center
                    )
                }
            }
        }

        Box(
            modifier = Modifier
                .fillMaxSize()
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null
                ) { controlsVisible = !controlsVisible }
        )

        AnimatedVisibility(
            visible = controlsVisible && error == null && !inPipMode,
            enter = fadeIn(),
            exit = fadeOut()
        ) {
            Box(modifier = Modifier.fillMaxSize()) {
                // Overlay scuro uniforme su tutto lo schermo
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Black.copy(alpha = 0.45f))
                )

                val horizontalSafePadding = with(LocalDensity.current) {
                    val horizontalInsets = WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal)
                    maxOf(
                        horizontalInsets.getLeft(this, LocalLayoutDirection.current),
                        horizontalInsets.getRight(this, LocalLayoutDirection.current)
                    ).toDp()
                } + 16.dp

                // Top bar
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top))
                        .padding(horizontal = horizontalSafePadding, vertical = 16.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = {
                            if (dlnaConnected != null) showExitCastDialog = true else onBack()
                        }) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = "Indietro",
                                tint = Color.White
                            )
                        }
                        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                            IconButton(onClick = enterPip) {
                                Icon(
                                    imageVector = Icons.Filled.PictureInPictureAlt,
                                    contentDescription = "Picture in picture",
                                    tint = Color.White
                                )
                            }
                        }
                        Spacer(modifier = Modifier.weight(1f))
                        // Durante la trasmissione su TV sottotitoli e impostazioni
                        // agiscono solo sul player locale (in pausa): nascondili.
                        if (dlnaConnected == null && subtitleTracks.isNotEmpty()) {
                            val subtitlesOn = selectedSubtitle != null
                            IconButton(onClick = { viewModel.toggleSubtitles() }) {
                                Icon(
                                    imageVector = if (subtitlesOn) Icons.Filled.ClosedCaption else Icons.Filled.ClosedCaptionOff,
                                    contentDescription = if (subtitlesOn) "Disabilita sottotitoli" else "Abilita sottotitoli",
                                    tint = if (subtitlesOn) Color.White else Color.White.copy(alpha = 0.55f)
                                )
                            }
                        }
                        // Trasmissione su TV via DLNA (LG, Samsung, ...).
                        IconButton(onClick = {
                            // All'apertura della modale metti in pausa il video locale.
                            if (dlnaConnected == null) {
                                viewModel.pausePlayback()
                                viewModel.discoverDlna()
                            }
                            showDlnaDialog = true
                        }) {
                            Icon(
                                imageVector = Icons.Filled.Cast,
                                contentDescription = "Trasmetti su TV",
                                tint = if (dlnaConnected != null) MaterialTheme.colorScheme.primary else Color.White
                            )
                        }
                        if (dlnaConnected == null) {
                            IconButton(onClick = { settingsPanel = null; settingsMenu = true }) {
                                Icon(
                                    imageVector = Icons.Filled.Settings,
                                    contentDescription = "Impostazioni",
                                    tint = Color.White
                                )
                            }
                        }
                    }
                    // Titolo sotto la riga dei pulsanti, allineato al pulsante indietro.
                    Column(modifier = Modifier.padding(start = 12.dp, top = 4.dp, end = 12.dp)) {
                        Text(
                            text = viewModel.title,
                            color = Color.White,
                            fontWeight = FontWeight.Bold,
                            fontSize = 18.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        if (viewModel.mediaType == "tv" && currentSeason > 0) {
                            val epLine = "S${currentSeason} E${currentEpisode}" +
                                (episodeTitle?.takeIf { it.isNotBlank() }?.let { " - $it" } ?: "")
                            Text(
                                text = epLine,
                                color = Color.White.copy(alpha = 0.6f),
                                fontSize = 13.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.padding(top = 2.dp)
                            )
                        }
                    }
                }

                // Center play/pause or replay. While buffering the middle slot
                // holds the spinner instead of the play button (drawn below), so
                // they never overlap.
                if (playbackEnded) {
                    Box(
                        modifier = Modifier
                            .align(Alignment.Center)
                            .size(68.dp)
                            .clip(CircleShape)
                            .background(Color.Black.copy(alpha = 0.55f))
                            .clickable { viewModel.replay() },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Filled.Replay,
                            contentDescription = "Riproduci dall'inizio",
                            tint = Color.White,
                            modifier = Modifier.size(40.dp)
                        )
                    }
                } else {
                    Row(
                        modifier = Modifier.align(Alignment.Center),
                        horizontalArrangement = Arrangement.spacedBy(24.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier
                                .size(48.dp)
                                .clip(CircleShape)
                                .background(Color.Black.copy(alpha = 0.55f))
                                .clickable { captureFrame(); viewModel.seekBack() },
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = Icons.Filled.Replay10,
                                contentDescription = "Indietro di 10 secondi",
                                tint = Color.White,
                                modifier = Modifier.size(28.dp)
                            )
                        }
                        // Middle slot: empty while buffering (spinner overlay fills
                        // it), otherwise the play/pause button. Circle is bigger than
                        // skip buttons (68dp vs 48dp).
                        Box(
                            modifier = Modifier.size(68.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            if (!buffering && !loading) {
                                Box(
                                    modifier = Modifier
                                        .size(68.dp)
                                        .clip(CircleShape)
                                        .background(Color.Black.copy(alpha = 0.55f))
                                        .clickable { viewModel.togglePlayPause() },
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(
                                        imageVector = if (isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                                        contentDescription = if (isPlaying) "Pausa" else "Play",
                                        tint = Color.White,
                                        modifier = Modifier.size(40.dp)
                                    )
                                }
                            }
                        }
                        Box(
                            modifier = Modifier
                                .size(48.dp)
                                .clip(CircleShape)
                                .background(Color.Black.copy(alpha = 0.55f))
                                .clickable { captureFrame(); viewModel.seekForward() },
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = Icons.Filled.Forward10,
                                contentDescription = "Avanti di 10 secondi",
                                tint = Color.White,
                                modifier = Modifier.size(28.dp)
                            )
                        }
                    }
                }

                // Bottom controls
                Column(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom))
                        .padding(horizontal = horizontalSafePadding, vertical = 16.dp)
                ) {
                    var sliderValue by remember { mutableLongStateOf(0L) }
                    var isSeeking by remember { mutableStateOf(false) }
                    LaunchedEffect(position) { if (!isSeeking) sliderValue = position }

                    val sliderInteractionSource = remember { MutableInteractionSource() }
                    val sliderColors = SliderDefaults.colors(
                        thumbColor = MaterialTheme.colorScheme.primary,
                        activeTrackColor = MaterialTheme.colorScheme.primary,
                        inactiveTrackColor = Color.White.copy(alpha = 0.3f)
                    )
                    val primaryColor = MaterialTheme.colorScheme.primary

                    val thumbWidth = 14.dp
                    val density = LocalDensity.current

                    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
                        val fraction = (sliderValue.toFloat() / (duration.coerceAtLeast(1)).toFloat()).coerceIn(0f, 1f)
                        val trackWidth = maxWidth - thumbWidth
                        val thumbCenterPx = with(density) { (thumbWidth / 2 + trackWidth * fraction).toPx() }

                        if (isSeeking) {
                            Layout(
                                content = {
                                    Text(
                                        text = Format.time(sliderValue / 1000.0),
                                        color = Color.White,
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Medium,
                                        textAlign = TextAlign.Center,
                                        modifier = Modifier
                                            .background(
                                                color = Color.Black.copy(alpha = 0.85f),
                                                shape = RoundedCornerShape(4.dp)
                                            )
                                            .padding(horizontal = 8.dp, vertical = 3.dp)
                                    )
                                }
                            ) { measurables, constraints ->
                                val placeable = measurables.first().measure(constraints.copy(minWidth = 0))
                                val x = (thumbCenterPx - placeable.width / 2f)
                                    .toInt()
                                    .coerceIn(0, constraints.maxWidth - placeable.width)
                                val y = with(density) { (-36).dp.roundToPx() }
                                layout(constraints.maxWidth, 0) {
                                    placeable.placeRelative(x, y)
                                }
                            }
                        }

                        Slider(
                            value = sliderValue.toFloat(),
                            onValueChange = {
                                sliderValue = it.toLong()
                                isSeeking = true
                            },
                            onValueChangeFinished = {
                                captureFrame()
                                viewModel.seekTo(sliderValue)
                                isSeeking = false
                            },
                            valueRange = 0f..(duration.coerceAtLeast(1)).toFloat(),
                            interactionSource = sliderInteractionSource,
                            thumb = {
                                Box(
                                    modifier = Modifier
                                        .size(thumbWidth)
                                        .clip(CircleShape)
                                        .background(MaterialTheme.colorScheme.primary)
                                )
                            },
                            track = {
                                val bufferedFraction = (bufferedPosition.toFloat() /
                                    duration.coerceAtLeast(1).toFloat()).coerceIn(0f, 1f)
                                Canvas(modifier = Modifier.fillMaxWidth().height(3.dp)) {
                                    val y = size.height / 2f
                                    val w = size.width
                                    val cap = StrokeCap.Round
                                    // remaining (faint background)
                                    drawLine(
                                        color = Color.White.copy(alpha = 0.3f),
                                        start = Offset(0f, y),
                                        end = Offset(w, y),
                                        strokeWidth = size.height,
                                        cap = cap
                                    )
                                    // buffered (grey, how much downloaded)
                                    if (bufferedFraction > 0f) {
                                        drawLine(
                                            color = Color.White.copy(alpha = 0.55f),
                                            start = Offset(0f, y),
                                            end = Offset(w * bufferedFraction, y),
                                            strokeWidth = size.height,
                                            cap = cap
                                        )
                                    }
                                    // played (primary)
                                    if (fraction > 0f) {
                                        drawLine(
                                            color = primaryColor,
                                            start = Offset(0f, y),
                                            end = Offset(w * fraction, y),
                                            strokeWidth = size.height,
                                            cap = cap
                                        )
                                    }
                                }
                            },
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = Format.time(sliderValue / 1000.0),
                            color = Color.White,
                            fontSize = 12.sp
                        )
                        Text(
                            text = Format.time(duration / 1000.0),
                            color = Color.White,
                            fontSize = 12.sp
                        )
                    }

                }
            }
        }

        // Buffering spinner: single source of truth, centered, drawn above the
        // controls so it occupies the (now empty) play/pause slot without overlap.
        if (buffering && !loading && error == null) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(
                    color = Color.White,
                    strokeWidth = 3.dp,
                    modifier = Modifier.size(48.dp)
                )
            }
        }

        val progressFraction = if (duration > 0) position.toFloat() / duration.toFloat() else 0f
        // Show only near the very end of the episode (or once it ended), so the prompt
        // doesn't linger for minutes.
        val showNextEpisodeButton = nextAvailable && (playbackEnded || progressFraction >= 0.95f)
        val safeBottom = with(LocalDensity.current) { WindowInsets.safeDrawing.getBottom(this).toDp() }
        val safeRight = with(LocalDensity.current) { WindowInsets.safeDrawing.getRight(this, LocalLayoutDirection.current).toDp() }
        AnimatedVisibility(
            visible = showNextEpisodeButton,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(
                    bottom = safeBottom + 100.dp,
                    end = safeRight + 16.dp
                )
        ) {
            // Pill coerente con i controlli del player: sfondo scuro semi-trasparente,
            // bordo sottile, contenuto bianco con icona skip-next.
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .background(Color.Black.copy(alpha = 0.65f))
                    .border(
                        width = 1.dp,
                        color = Color.White.copy(alpha = 0.25f),
                        shape = RoundedCornerShape(50)
                    )
                    .clickable {
                        viewModel.playNextEpisode()
                        onNextEpisode()
                    }
                    .padding(horizontal = 16.dp, vertical = 10.dp)
            ) {
                Text(
                    text = "Prossimo episodio",
                    color = Color.White,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium
                )
                Icon(
                    imageVector = Icons.Filled.SkipNext,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(20.dp)
                )
            }
        }

        if (showExitCastDialog) {
            AlertDialog(
                onDismissRequest = { showExitCastDialog = false },
                containerColor = Color(0xFF1E1E20),
                title = { Text("Trasmissione in corso", color = Color.White) },
                text = {
                    Text(
                        "Vuoi interrompere la trasmissione o lasciarla attiva in background?",
                        color = Color.White.copy(alpha = 0.8f)
                    )
                },
                confirmButton = {
                    TextButton(onClick = {
                        showExitCastDialog = false
                        onBack()
                    }) {
                        Text("Continua in background")
                    }
                },
                dismissButton = {
                    TextButton(onClick = {
                        showExitCastDialog = false
                        viewModel.stopDlna()
                        onBack()
                    }) {
                        Text("Interrompi", color = MaterialTheme.colorScheme.error)
                    }
                }
            )
        }

        if (showDlnaDialog) {
            AlertDialog(
                onDismissRequest = { showDlnaDialog = false },
                containerColor = Color(0xFF1E1E20),
                title = { Text("Trasmetti su TV", color = Color.White) },
                text = {
                    Column {
                        val connected = dlnaConnected
                        if (connected != null) {
                            Text(
                                "In riproduzione su ${connected.friendlyName}",
                                color = Color.White
                            )
                        } else if (dlnaScanning) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(20.dp),
                                    strokeWidth = 2.dp,
                                    color = MaterialTheme.colorScheme.primary
                                )
                                Spacer(modifier = Modifier.width(12.dp))
                                Text("Ricerca dispositivi…", color = Color.White)
                            }
                        } else if (dlnaRenderers.isEmpty()) {
                            Text(
                                "Nessun dispositivo trovato. Verifica che la TV sia accesa e sulla stessa rete Wi-Fi.",
                                color = Color.White.copy(alpha = 0.7f)
                            )
                        } else {
                            dlnaRenderers.forEach { renderer ->
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable {
                                            if (isOfflinePlayback) {
                                                pendingOfflineRenderer = renderer
                                                showOfflineCastWarning = true
                                            } else {
                                                viewModel.castToDlna(renderer)
                                                showDlnaDialog = false
                                            }
                                        }
                                        .padding(vertical = 12.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(
                                        imageVector = Icons.Filled.Tv,
                                        contentDescription = null,
                                        tint = Color.White
                                    )
                                    Spacer(modifier = Modifier.width(12.dp))
                                    Text(renderer.friendlyName, color = Color.White)
                                }
                            }
                        }
                    }
                },
                confirmButton = {
                    if (dlnaConnected != null) {
                        TextButton(onClick = {
                            viewModel.stopDlna()
                            showDlnaDialog = false
                        }) {
                            Text("Interrompi", color = MaterialTheme.colorScheme.error)
                        }
                    } else {
                        TextButton(
                            onClick = { viewModel.discoverDlna() },
                            enabled = !dlnaScanning
                        ) {
                            Text("Aggiorna")
                        }
                    }
                },
                dismissButton = {
                    TextButton(onClick = { showDlnaDialog = false }) {
                        Text("Chiudi", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            )
        }

        if (showOfflineCastWarning) {
            AlertDialog(
                onDismissRequest = { showOfflineCastWarning = false },
                containerColor = Color(0xFF1E1E20),
                title = { Text("Cast da offline", color = Color.White) },
                text = {
                    Text(
                        "Il contenuto è scaricato offline. La TV lo riprodurrà in streaming via internet, consumando dati di rete. Continuare?",
                        color = Color.White.copy(alpha = 0.8f)
                    )
                },
                confirmButton = {
                    TextButton(onClick = {
                        showOfflineCastWarning = false
                        showDlnaDialog = false
                        pendingOfflineRenderer?.let { viewModel.castToDlna(it, forceStreaming = true) }
                        pendingOfflineRenderer = null
                    }) {
                        Text("Continua")
                    }
                },
                dismissButton = {
                    TextButton(onClick = {
                        showOfflineCastWarning = false
                        pendingOfflineRenderer = null
                    }) {
                        Text("Annulla", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            )
        }

        if (settingsMenu) {
            val aspectOptions = listOf(
                AspectRatioFrameLayout.RESIZE_MODE_FIT to "Adatta",
                AspectRatioFrameLayout.RESIZE_MODE_ZOOM to "Riempi schermo"
            )
            val speedOptions = listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f)
            fun speedLabel(s: Float): String = when {
                s == 1f -> "Normale"
                s == s.toInt().toFloat() -> "${s.toInt()}x"
                else -> "${s}x"
            }
            fun aspectLabel(mode: Int): String =
                if (mode == AspectRatioFrameLayout.RESIZE_MODE_ZOOM) "Riempi schermo" else "Adatta"

            Dialog(onDismissRequest = { settingsMenu = false }) {
                Surface(
                    shape = RoundedCornerShape(20.dp),
                    color = Color(0xFF1E1E20)
                ) {
                    Column(
                        modifier = Modifier
                            .width(360.dp)
                            .padding(vertical = 12.dp)
                    ) {
                        // Header fisso (solo nei sotto-pannelli): non scorre con la lista.
                        val panelTitle = when (settingsPanel) {
                            "subtitles" -> "Sottotitoli"
                            "audio" -> "Audio"
                            "speed" -> "Velocità di riproduzione"
                            "quality" -> "Qualità video"
                            "aspect" -> "Formato video"
                            "server" -> "Selezione server"
                            else -> null
                        }
                        if (panelTitle != null) {
                            PlayerPanelHeader(panelTitle) { settingsPanel = null }
                        }
                        Column(
                            modifier = Modifier
                                .heightIn(max = 280.dp)
                                .verticalScroll(rememberScrollState())
                        ) {
                            when (settingsPanel) {
                                "subtitles" -> {
                                    PlayerOptionRow("Disattivati", selectedSubtitle == null) {
                                        viewModel.disableSubtitles(); settingsPanel = null
                                    }
                                    subtitleTracks.forEach { track ->
                                        PlayerOptionRow(
                                            track.label.takeIf { it.isNotBlank() } ?: "Sottotitoli",
                                            selectedSubtitle?.uniqueId == track.uniqueId
                                        ) { viewModel.selectSubtitleTrack(track); settingsPanel = null }
                                    }
                                }
                                "audio" -> {
                                    audioTracks.forEach { track ->
                                        PlayerOptionRow(
                                            track.label.takeIf { it.isNotBlank() } ?: "Traccia audio",
                                            selectedAudio?.uniqueId == track.uniqueId
                                        ) { viewModel.selectAudioTrack(track); settingsPanel = null }
                                    }
                                }
                                "speed" -> {
                                    speedOptions.forEach { s ->
                                        PlayerOptionRow(speedLabel(s), playbackSpeed == s) {
                                            viewModel.setPlaybackSpeed(s); settingsPanel = null
                                        }
                                    }
                                }
                                "quality" -> {
                                    PlayerOptionRow("Auto", selectedVideoQuality == null) {
                                        viewModel.setAutoVideoQuality(); settingsPanel = null
                                    }
                                    videoTracks.forEach { track ->
                                        PlayerOptionRow(
                                            track.label,
                                            selectedVideoQuality?.formatId == track.formatId
                                        ) { viewModel.selectVideoQuality(track); settingsPanel = null }
                                    }
                                }
                                "aspect" -> {
                                    aspectOptions.forEach { (mode, label) ->
                                        PlayerOptionRow(label, resizeMode == mode) {
                                            resizeMode = mode; settingsPanel = null
                                        }
                                    }
                                }
                                "server" -> {
                                    sources.forEachIndexed { index, src ->
                                        PlayerOptionRow("Server ${index + 1}", currentSourceIndex == index) {
                                            viewModel.selectSource(src); settingsPanel = null
                                        }
                                    }
                                }
                                else -> {
                                    PlayerSettingsRow(
                                        Icons.Filled.ClosedCaption, "Sottotitoli",
                                        selectedSubtitle?.label?.takeIf { it.isNotBlank() } ?: "Disattivati",
                                        subtitleTracks.isNotEmpty()
                                    ) { settingsPanel = "subtitles" }
                                    PlayerSettingsRow(
                                        Icons.Filled.Audiotrack, "Audio",
                                        selectedAudio?.label?.takeIf { it.isNotBlank() } ?: "—",
                                        audioTracks.isNotEmpty()
                                    ) { settingsPanel = "audio" }
                                    PlayerSettingsRow(
                                        Icons.Filled.Speed, "Velocità di riproduzione",
                                        speedLabel(playbackSpeed), true
                                    ) { settingsPanel = "speed" }
                                    PlayerSettingsRow(
                                        Icons.Filled.HighQuality, "Qualità video",
                                        selectedVideoQuality?.label ?: "Auto",
                                        videoTracks.size > 1
                                    ) { settingsPanel = "quality" }
                                    PlayerSettingsRow(
                                        Icons.Filled.AspectRatio, "Formato video",
                                        aspectLabel(resizeMode), true
                                    ) { settingsPanel = "aspect" }
                                    PlayerSettingsRow(
                                        Icons.Filled.Dns, "Selezione server",
                                        "Server ${currentSourceIndex + 1}", sources.size > 1
                                    ) { settingsPanel = "server" }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PlayerSettingsRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    value: String,
    enabled: Boolean,
    onClick: () -> Unit
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .then(if (enabled) Modifier.clickable(onClick = onClick) else Modifier)
            .alpha(if (enabled) 1f else 0.4f)
            .padding(horizontal = 20.dp, vertical = 14.dp)
    ) {
        Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(22.dp))
        Spacer(modifier = Modifier.width(18.dp))
        Text(
            text = label,
            color = Color.White,
            fontSize = 16.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            modifier = Modifier.weight(1f)
        )
        Text(text = value, color = Color.White.copy(alpha = 0.6f), fontSize = 14.sp, maxLines = 1)
        Spacer(modifier = Modifier.width(4.dp))
        Icon(
            Icons.Filled.ChevronRight,
            contentDescription = null,
            tint = Color.White.copy(alpha = 0.6f),
            modifier = Modifier.size(20.dp)
        )
    }
}

@Composable
private fun PlayerPanelHeader(title: String, onBack: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 4.dp)
    ) {
        IconButton(onClick = onBack) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Indietro", tint = Color.White)
        }
        Text(text = title, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun PlayerOptionRow(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp)
    ) {
        RadioButton(
            selected = selected,
            onClick = onClick,
            colors = androidx.compose.material3.RadioButtonDefaults.colors(
                selectedColor = Color.White,
                unselectedColor = Color.White.copy(alpha = 0.6f)
            )
        )
        Spacer(modifier = Modifier.width(8.dp))
        Text(text = label, color = Color.White, fontSize = 15.sp)
    }
}
