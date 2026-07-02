package com.streamo.app.ui.player

import android.app.Activity
import android.content.Context
import android.content.pm.ActivityInfo
import android.view.View
import android.view.WindowManager
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
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
import androidx.compose.material.icons.filled.Lock
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
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
import androidx.compose.ui.layout.onSizeChanged
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
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.streamo.app.player.PipController
import com.streamo.app.player.dlna.DlnaRenderer
import com.streamo.app.player.chromecast.ChromecastRenderer
import com.streamo.app.player.lancast.LanRenderer
import com.streamo.app.ui.common.GlassAlertDialog
import com.streamo.app.ui.common.GlassDialog
import com.streamo.app.ui.common.GlassDialogDestructiveButton
import com.streamo.app.ui.common.GlassDialogNeutralButton
import com.streamo.app.ui.common.GlassDialogPrimaryButton
import com.streamo.app.ui.common.GlassDefaults
import com.streamo.app.ui.common.glassCapsule
import com.streamo.app.ui.player.cast.CastDeviceGroup
import com.streamo.app.ui.player.cast.CastPickerDialog
import com.streamo.app.util.Format
import com.streamo.app.util.isTabletDevice
import com.streamo.app.util.isTvDevice
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.hazeSource

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
    val warpEnabled by viewModel.warpEnabled.collectAsState()
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
    val streamingLimit by viewModel.streamingLimit.collectAsState()
    val currentAutoHeight by viewModel.currentAutoHeight.collectAsState()
    val playbackSpeed by viewModel.playbackSpeed.collectAsState()
    val currentSourceIndex by viewModel.currentSourceIndex.collectAsState()
    val currentSeason by viewModel.currentSeason.collectAsState()
    val currentEpisode by viewModel.currentEpisode.collectAsState()
    val episodeTitle by viewModel.episodeTitle.collectAsState()
    val isOfflinePlayback by viewModel.isOfflinePlayback.collectAsState()
    val dlnaRenderers by viewModel.dlnaRenderers.collectAsState()
    val dlnaScanning by viewModel.dlnaScanning.collectAsState()
    val dlnaConnected by viewModel.dlnaConnected.collectAsState()
    val lanRenderers by viewModel.lanRenderers.collectAsState()
    val lanScanning by viewModel.lanScanning.collectAsState()
    val castProtocolPrefs by viewModel.castProtocolPrefs.collectAsState()
    val lanConnected by viewModel.lanConnected.collectAsState()
    val chromecastRenderers by viewModel.chromecastRenderers.collectAsState()
    val chromecastScanning by viewModel.chromecastScanning.collectAsState()
    val chromecastConnected by viewModel.chromecastConnected.collectAsState()
    val skipPrompt by viewModel.skipPrompt.collectAsState()
    var showCastDialog by remember { mutableStateOf(false) }
    var showExitCastDialog by remember { mutableStateOf(false) }
    var showOfflineCastWarning by remember { mutableStateOf(false) }
    var pendingOfflineRenderer by remember { mutableStateOf<com.streamo.app.player.dlna.DlnaRenderer?>(null) }
    var pendingOfflineChromecast by remember { mutableStateOf<ChromecastRenderer?>(null) }
    val pendingCastSwitch by viewModel.pendingCastSwitch.collectAsState()
    var pendingLanRenderer by remember { mutableStateOf<com.streamo.app.player.lancast.LanRenderer?>(null) }

    val isCastActive = dlnaConnected != null || lanConnected != null || chromecastConnected != null
    val castDeviceName = dlnaConnected?.friendlyName
        ?: lanConnected?.friendlyName
        ?: chromecastConnected?.friendlyName
        ?: "TV"
    val castProtocol = when {
        lanConnected != null -> "streamo"
        chromecastConnected != null -> "chromecast"
        dlnaConnected != null -> "dlna"
        else -> null
    }

    // Ferma la discovery Cast continua appena la modale si chiude (qualunque sia il motivo:
    // dismiss, selezione device, stop). DLNA/Obsidian sono one-shot e si esauriscono da soli;
    // la callback MediaRouter del Cast invece resterebbe attiva consumando batteria.
    LaunchedEffect(showCastDialog) {
        if (!showCastDialog) viewModel.stopCastDiscovery()
    }

    var settingsMenu by remember { mutableStateOf(false) }
    // null = lista principale; "subtitles"/"audio"/"speed"/"aspect"/"server" = sotto-pannello
    var settingsPanel by remember { mutableStateOf<String?>(null) }
    var resizeMode by remember { mutableIntStateOf(AspectRatioFrameLayout.RESIZE_MODE_FIT) }
    var controlsVisible by remember { mutableStateOf(true) }
    var controlsPulse by remember { mutableIntStateOf(0) }
    val resetControls = {
        controlsVisible = true
        controlsPulse += 1
    }

    LaunchedEffect(settingsMenu) {
        if (settingsMenu) {
            viewModel.refreshAvailableTracks()
        }
    }

    var playerViewRef by remember { mutableStateOf<PlayerView?>(null) }
    // Snapshot of the last frame, painted over the player while seeking/buffering so
    // the screen never goes black. Captured from the TextureView right before a seek.
    var frozenFrame by remember { mutableStateOf<android.graphics.Bitmap?>(null) }
    // HazeState locale del player: il video (TextureView) è la hazeSource; i controlli
    // come fratelli fanno hazeEffect → blur LIVE del video, fluido e ad alta risoluzione.
    val playerHazeState = remember { HazeState() }
    // Modalità prestazioni: salta le animazioni dei controlli (thumb, bolla tempo).
    val reducedEffects = com.streamo.app.ui.common.LocalReducedEffects.current
    // Il video è una TextureView (necessaria perché Haze possa sfocarla — la SurfaceView
    // non entra nel layer Compose). TextureView espone getBitmap() diretto.
    val captureFrame: () -> Unit = {
        val tv = playerViewRef?.videoSurfaceView as? android.view.TextureView
        if (tv != null && tv.width > 0 && tv.height > 0 && tv.isAvailable) {
            try {
                frozenFrame = tv.getBitmap(tv.width, tv.height)
            } catch (_: Exception) { /* surface non valida → fallback nero */ }
        }
    }
    // Stato della timeline issato qui (non dentro i bottom controls) così il
    // freeze-frame può restare visibile per TUTTO lo scrub (drag + seek), mascherando
    // il bordo verde del decoder-flush sulla destra.
    var sliderValue by remember { mutableLongStateOf(0L) }
    var isSeeking by remember { mutableStateOf(false) }
    // Non sincronizzare la posizione mentre la durata è ancora sconosciuta: il resume
    // position (es. 20 min) diviso per duration=0 faceva apparire la barra piena.
    LaunchedEffect(position, duration) { if (!isSeeking && duration > 0) sliderValue = position }

    // Show the frozen frame whenever we'd otherwise see black/green: while dragging the
    // slider, during a manual seek (decoder flush), or while buffering.
    val freezeVisible = (isSeeking || seekingManually || buffering) && !loading && error == null

    // Drop the frozen frame once playback is ready again (a fresh frame is rendered).
    LaunchedEffect(buffering, seekingManually, isSeeking) {
        if (!buffering && !seekingManually && !isSeeking && frozenFrame != null) {
            delay(150)
            frozenFrame = null
        }
    }

    // Auto-hide dei controlli: dopo 3.5s di inattività spariscono quando si sta
    // riproducendo (o trasmettendo in cast), a meno che non ci sia un dialog aperto.
    LaunchedEffect(controlsVisible, controlsPulse, isPlaying, isCastActive, settingsMenu, showCastDialog, showExitCastDialog, showOfflineCastWarning) {
        if (controlsVisible && (isPlaying || isCastActive) && !settingsMenu && !showCastDialog && !showExitCastDialog && !showOfflineCastWarning) {
            delay(3500)
            controlsVisible = false
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
        // Orientamento del player: su phone/TV lo gestisce qui PlayerScreen. Su
        // tablet NO — lo possiede TabletRootView (keyed sulla destinazione Player),
        // perché su rotazione il tablet fa swap di shell e distrugge/ricrea questo
        // PlayerScreen: il suo onDispose finirebbe in race con il LaunchedEffect del
        // nuovo, lasciando l'orientamento sbloccato (player in verticale).
        val act = context as? Activity
        if (act != null && !context.isTabletDevice()) {
            act.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        }
    }

    // Durante il cast il video è sulla TV: lascia spegnere lo schermo del telefono
    // (il proxy resta vivo via wake/wifi lock). In locale tieni lo schermo acceso.
    LaunchedEffect(isCastActive) {
        val window = (context as? Activity)?.window ?: return@LaunchedEffect
        if (isCastActive) {
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
            // Ripristina la policy di orientamento normale: TV resta landscape,
            // phone torna a portrait. Sul TABLET non tocchiamo nulla: l'orientamento
            // è di TabletRootView, e scrivere qui durante lo swap di shell su
            // rotazione lo desincronizzerebbe (player che ruota in verticale).
            val orientAct = context as? Activity
            if (orientAct != null && !context.isTabletDevice()) {
                orientAct.requestedOrientation = if (context.isTvDevice())
                    ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                else ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            }
            // Ripristina il baseline dell'app: edge-to-edge (decorFits = false, come
            // enableEdgeToEdge in MainActivity), NON true. Mettere true qui lasciava
            // la finestra in modalità "fit" dopo il player, desincronizzando il
            // dispatch delle insets (su API < 30 era proprio questo flip a far
            // "saltare su" la navbar di sistema dopo la prima riproduzione).
            WindowCompat.setDecorFitsSystemWindows(window ?: return@onDispose, false)
            WindowInsetsControllerCompat(window ?: return@onDispose, decorView ?: return@onDispose).show(WindowInsetsCompat.Type.systemBars())
            // NON azzerare a SYSTEM_UI_FLAG_VISIBLE (0): cancellerebbe i flag LAYOUT_*
            // che su API < 30 tengono il contenuto edge-to-edge (disegnato DIETRO le
            // barre). Senza quei flag il decor torna in "fit" e si restringe di
            // nav-bar, MA Compose continua a riportare navigationBars=144 → la navbar
            // glass si solleva del doppio (288) dopo la prima riproduzione. Ripristina
            // invece esattamente il baseline edge-to-edge (stessi flag di
            // enableEdgeToEdge): così le barre tornano visibili ma l'inset resta 144.
            @Suppress("DEPRECATION")
            decorView?.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            )
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
        if (isCastActive) {
            // In trasmissione: chiedi se interrompere o continuare in background.
            showExitCastDialog = true
        } else if (viewModel.player.isPlaying && android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            enterPip()
        } else {
            onBack()
        }
    }

    val inPipMode by PipController.inPipMode.collectAsState()

    Box(modifier = Modifier.fillMaxSize()) {
        // hazeSource locale: SOLO il video (TextureView) + freeze frame. I controlli
        // sono fratelli e fanno hazeEffect → blur live. Se l'effetto fosse DENTRO la
        // sorgente → SIGSEGV.
        Box(modifier = Modifier.fillMaxSize().hazeSource(playerHazeState)) {
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

        // Durante il cast il video locale è fermo: la TextureView trattiene l'ultimo
        // frame del video precedente. Copri la sorgente haze con nero così i controlli
        // glass sfocano nero, non il frame stantio.
        if (isCastActive) {
            Box(modifier = Modifier.fillMaxSize().background(Color.Black))
        }
        } // chiusura hazeSource Box (video + freeze)

        if (loading) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.6f)),
                contentAlignment = Alignment.Center
            ) {
                androidx.compose.foundation.layout.Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(16.dp)
                ) {
                    CircularProgressIndicator(
                        color = Color.White,
                        strokeWidth = 3.dp,
                        modifier = Modifier.size(48.dp)
                    )
                }
            }
        }

        // Schermo scuro durante la trasmissione su TV: il video è sulla TV, qui mostriamo
        // solo lo stato. I controlli del player (toccando lo schermo) comandano la TV.
        if (isCastActive) {
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
                        text = "Trasmissione su $castDeviceName",
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

        val horizontalSafePadding = with(LocalDensity.current) {
            val horizontalInsets = WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal)
            maxOf(
                horizontalInsets.getLeft(this, LocalLayoutDirection.current),
                horizontalInsets.getRight(this, LocalLayoutDirection.current)
            ).toDp()
        } + 16.dp

        if (!inPipMode) {
            Box(modifier = Modifier.fillMaxSize()) {
                // Area tappabile per mostrare/nascondere i controlli.
                // Sta dietro a tutti i controlli in z-order; i pulsanti intercettano
                // il tocco prima, quindi il toggle scatta solo su aree vuote.
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .clickable(
                            indication = null,
                            interactionSource = remember { MutableInteractionSource() }
                        ) {
                            controlsVisible = !controlsVisible
                            if (controlsVisible) controlsPulse += 1
                        }
                )

                val hasError = error != null

                AnimatedVisibility(
                    visible = controlsVisible,
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

                // Top bar
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top))
                        .padding(horizontal = horizontalSafePadding, vertical = 16.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier.glassCapsule(playerHazeState, CircleShape)
                        ) {
                            IconButton(onClick = {
                                resetControls()
                                if (isCastActive) showExitCastDialog = true else onBack()
                            }) {
                                Icon(
                                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                                    contentDescription = "Indietro",
                                    tint = Color.White
                                )
                            }
                        }
                        Spacer(modifier = Modifier.weight(1f))
                        // Azioni a destra raggruppate in un'unica pillola glass (blur),
                        // coerente con la top bar della Home (GlassTopBar).
                        Row(
                            modifier = Modifier
                                .glassCapsule(playerHazeState, GlassDefaults.ChipShape)
                                .padding(horizontal = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                                IconButton(onClick = { resetControls(); enterPip() }) {
                                    Icon(
                                        imageVector = Icons.Filled.PictureInPictureAlt,
                                        contentDescription = "Picture in picture",
                                        tint = Color.White
                                    )
                                }
                            }
                            // Durante la trasmissione su TV sottotitoli e impostazioni
                            // agiscono solo sul player locale (in pausa): nascondili.
                            if (!isCastActive && subtitleTracks.isNotEmpty()) {
                                val subtitlesOn = selectedSubtitle != null
                                IconButton(onClick = { resetControls(); viewModel.toggleSubtitles() }) {
                                    Icon(
                                        imageVector = if (subtitlesOn) Icons.Filled.ClosedCaption else Icons.Filled.ClosedCaptionOff,
                                        contentDescription = if (subtitlesOn) "Disabilita sottotitoli" else "Abilita sottotitoli",
                                        tint = if (subtitlesOn) Color.White else Color.White.copy(alpha = 0.55f)
                                    )
                                }
                            }
                            // Trasmissione su TV (DLNA o Obsidian).
                            IconButton(onClick = {
                                resetControls()
                                // All'apertura della modale metti in pausa il video locale.
                                if (!isCastActive) {
                                    viewModel.pausePlayback()
                                    viewModel.discoverDlna()
                                }
                                showCastDialog = true
                            }) {
                                Icon(
                                    imageVector = Icons.Filled.Cast,
                                    contentDescription = "Trasmetti su TV",
                                    tint = if (isCastActive) MaterialTheme.colorScheme.primary else Color.White
                                )
                            }
                            if (!isCastActive) {
                                IconButton(onClick = { resetControls(); settingsPanel = null; settingsMenu = true }) {
                                    Icon(
                                        imageVector = Icons.Filled.Settings,
                                        contentDescription = "Impostazioni",
                                        tint = Color.White
                                    )
                                }
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

                // Center: errore mostra messaggio + restart, altrimenti play/pause o replay.
                if (hasError) {
                    Column(
                        modifier = Modifier.align(Alignment.Center),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Text(
                            text = error!!,
                            color = Color.White.copy(alpha = 0.85f),
                            fontSize = 15.sp,
                            textAlign = TextAlign.Center,
                            maxLines = 3,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(horizontal = 32.dp)
                        )
                        Box(
                            modifier = Modifier
                                .size(52.dp)
                                .glassCapsule(playerHazeState, CircleShape)
                                .clickable { resetControls(); viewModel.load() },
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = Icons.Filled.Replay,
                                contentDescription = "Riprova",
                                tint = Color.White,
                                modifier = Modifier.size(30.dp)
                            )
                        }
                    }
                } else if (playbackEnded) {
                    Box(
                        modifier = Modifier
                            .align(Alignment.Center)
                            .size(68.dp)
                            .glassCapsule(playerHazeState, CircleShape)
                            .clickable { resetControls(); viewModel.replay() },
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
                                .glassCapsule(playerHazeState, CircleShape)
                                .clickable { resetControls(); captureFrame(); viewModel.seekBack() },
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
                                        .glassCapsule(playerHazeState, CircleShape)
                                        .clickable { resetControls(); viewModel.togglePlayPause() },
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
                                .glassCapsule(playerHazeState, CircleShape)
                                .clickable { resetControls(); captureFrame(); viewModel.seekForward() },
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

                // Bottom controls — barra glass: blur del video dietro (stesso
                // playerHazeState dei pulsanti). Se errore, timeline solo display.
                Column(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        // Player immersivo: le barre di sistema sono nascoste, quindi
                        // i controlli vanno al bordo reale. Su API 30+ nascondere le
                        // barre azzera già l'inset (safeDrawing → 0). Su API < 30 il
                        // controller usa i flag legacy: le barre spariscono a video ma
                        // l'inset di sistema NON viene azzerato, restando ~nav-bar e
                        // sollevando la timeline "come se ci fosse la navbar". Lì lo
                        // forziamo a 0.
                        .windowInsetsPadding(
                            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R)
                                WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom)
                            else androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0)
                        )
                        .padding(horizontal = horizontalSafePadding, vertical = 16.dp)
                        .glassCapsule(playerHazeState, RoundedCornerShape(24.dp))
                        .padding(horizontal = 24.dp, vertical = 8.dp)
                ) {
                    val sliderInteractionSource = remember { MutableInteractionSource() }
                    val sliderColors = SliderDefaults.colors(
                        thumbColor = MaterialTheme.colorScheme.primary,
                        activeTrackColor = MaterialTheme.colorScheme.primary,
                        inactiveTrackColor = Color.White.copy(alpha = 0.3f)
                    )
                    val primaryColor = MaterialTheme.colorScheme.primary
                    val sliderEnabled = !hasError

                    // Thumb cresce durante il drag (14 → 20dp) con alone bianco.
                    val thumbSize by animateDpAsState(
                        targetValue = if (isSeeking) 20.dp else 14.dp,
                        animationSpec = if (reducedEffects) snap() else tween(150),
                        label = "thumbSize"
                    )

                    // Tempi sopra la barra.
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
                    // Altezza ridotta: comprime il padding interno dello Slider Material
                    // (~48dp) avvicinando la barra ai tempi.
                    BoxWithConstraints(modifier = Modifier.fillMaxWidth().height(24.dp)) {
                        // Frazioni a 0 finché la durata non è nota, altrimenti con
                        // resume position > 0 e duration = 0 la barra risultava piena.
                        val fraction = if (duration > 0) (sliderValue.toFloat() / duration.toFloat()).coerceIn(0f, 1f) else 0f
                        val trackWidth = maxWidth
                        val density = LocalDensity.current
                        var bubbleWidth by remember { mutableStateOf(0.dp) }

                        androidx.compose.animation.AnimatedVisibility(
                            visible = isSeeking && sliderEnabled,
                            enter = if (reducedEffects) EnterTransition.None else fadeIn(),
                            exit = if (reducedEffects) ExitTransition.None else fadeOut(),
                            modifier = Modifier
                                .align(Alignment.TopStart)
                                .offset(
                                    x = (trackWidth * fraction - bubbleWidth / 2)
                                        .coerceIn(0.dp, (trackWidth - bubbleWidth).coerceAtLeast(0.dp)),
                                    y = (-64).dp
                                )
                        ) {
                            Box(
                                modifier = Modifier
                                    .onSizeChanged { bubbleWidth = with(density) { it.width.toDp() } }
                                    .glassCapsule(playerHazeState, RoundedCornerShape(12.dp))
                                    .padding(horizontal = 12.dp, vertical = 5.dp)
                            ) {
                                Text(
                                    text = Format.time(sliderValue / 1000.0),
                                    color = Color.White,
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.SemiBold
                                )
                            }
                        }

                        if (sliderEnabled) {
                            Slider(
                                value = sliderValue.toFloat(),
                                onValueChange = {
                                    resetControls()
                                    if (!isSeeking) captureFrame()
                                    sliderValue = it.toLong()
                                    isSeeking = true
                                },
                                onValueChangeFinished = {
                                    resetControls()
                                    captureFrame()
                                    viewModel.seekTo(sliderValue)
                                    isSeeking = false
                                },
                                valueRange = 0f..(duration.coerceAtLeast(1)).toFloat(),
                                interactionSource = sliderInteractionSource,
                                thumb = {
                                    Box(
                                        modifier = Modifier
                                            .size(thumbSize)
                                            .clip(CircleShape)
                                            .background(MaterialTheme.colorScheme.primary)
                                    )
                                },
                                track = {
                                    val bufferedFraction = if (duration > 0) (bufferedPosition.toFloat() /
                                        duration.toFloat()).coerceIn(0f, 1f) else 0f
                                    Canvas(modifier = Modifier.fillMaxWidth().height(4.dp)) {
                                        val y = size.height / 2f
                                        val w = size.width
                                        val cap = StrokeCap.Round
                                        drawLine(color = Color.White.copy(alpha = 0.25f), start = Offset(0f, y), end = Offset(w, y), strokeWidth = size.height, cap = cap)
                                        if (bufferedFraction > 0f) {
                                            drawLine(color = Color.White.copy(alpha = 0.5f), start = Offset(0f, y), end = Offset(w * bufferedFraction, y), strokeWidth = size.height, cap = cap)
                                        }
                                        if (fraction > 0f) {
                                            drawLine(color = primaryColor, start = Offset(0f, y), end = Offset(w * fraction, y), strokeWidth = size.height, cap = cap)
                                        }
                                    }
                                },
                                modifier = Modifier.fillMaxWidth()
                            )
                        } else {
                            Canvas(
                                modifier = Modifier.fillMaxWidth().height(4.dp).alpha(0.5f)
                            ) {
                                val w = size.width
                                drawLine(color = Color.White.copy(alpha = 0.25f), start = Offset(0f, size.height / 2f), end = Offset(w, size.height / 2f), strokeWidth = size.height, cap = StrokeCap.Round)
                                if (fraction > 0f) {
                                    drawLine(color = primaryColor, start = Offset(0f, size.height / 2f), end = Offset(w * fraction, size.height / 2f), strokeWidth = size.height, cap = StrokeCap.Round)
                                }
                            }
                        }
                    }
                }
                    }
                }
            }
        }

        // Badge WARP — poco sotto i pulsanti centrali (play/skip).
        // Fuori dall'AnimatedVisibility dei controlli ma dentro la Box principale.
        // Disegnato dopo i controlli per stare sopra in z-order.
        // Nascosto durante il cast via app (LanCast): lo stream viene servito dal TV.
        // Resta visibile col cast DLNA (lo stream passa ancora dal telefono via proxy).
        if (warpEnabled && error == null && !inPipMode && lanConnected == null) {
            AnimatedVisibility(
                visible = controlsVisible,
                enter = fadeIn(),
                exit = fadeOut(),
                modifier = Modifier
                    .align(Alignment.Center)
                    .offset(y = 64.dp)
            ) {
                WarpBadge()
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

        // Skip intro / credits + prossimo episodio. Galleggiano sopra la barra
        // glass dei controlli, allineati orizzontalmente con la timeline (padding
        // interno della capsula = 24.dp) e con lo stesso background blur della barra.
        val skipVisible = skipPrompt != null
        AnimatedVisibility(
            visible = skipVisible || showNextEpisodeButton,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(
                    bottom = safeBottom + 100.dp,
                    end = horizontalSafePadding + 24.dp
                )
        ) {
            if (skipVisible) {
                val skipLabel = when (skipPrompt) {
                    PlayerViewModel.SkipPrompt.INTRO -> "Salta intro"
                    PlayerViewModel.SkipPrompt.CREDITS -> "Salta crediti"
                    null -> ""
                }
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier
                        .height(44.dp)
                        .glassCapsule(playerHazeState, GlassDefaults.ChipShape)
                        .clickable {
                            resetControls()
                            viewModel.performSkip()
                        }
                        .padding(horizontal = 16.dp)
                ) {
                    Text(
                        text = skipLabel,
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
            } else if (showNextEpisodeButton) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier
                        .height(44.dp)
                        .glassCapsule(playerHazeState, GlassDefaults.ChipShape)
                        .clickable {
                            resetControls()
                            viewModel.playNextEpisode()
                            onNextEpisode()
                        }
                        .padding(horizontal = 16.dp)
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
        }


        if (showExitCastDialog) {
            GlassAlertDialog(
                onDismissRequest = { showExitCastDialog = false },
                hazeState = playerHazeState,
                title = "Trasmissione in corso",
                text = {
                    Text(
                        "Vuoi interrompere la trasmissione o lasciarla attiva in background?"
                    )
                },
                confirmButton = {
                    GlassDialogDestructiveButton(onClick = {
                        showExitCastDialog = false
                        viewModel.stopCast()
                        onBack()
                    }) {
                        Text("Interrompi")
                    }
                },
                dismissButton = {
                    GlassDialogNeutralButton(onClick = {
                        showExitCastDialog = false
                        onBack()
                    }) {
                        Text("Continua in background")
                    }
                }
            )
        }

        if (showCastDialog) {
            val groups = remember(dlnaRenderers, lanRenderers, chromecastRenderers) {
                buildCastDeviceGroups(dlnaRenderers, lanRenderers, chromecastRenderers)
            }
            CastPickerDialog(
                hazeState = playerHazeState,
                groups = groups,
                dlnaScanning = dlnaScanning,
                lanScanning = lanScanning,
                chromecastScanning = chromecastScanning,
                connectedName = if (isCastActive) castDeviceName else null,
                connectedProtocol = castProtocol,
                preferredProtocol = { key -> castProtocolPrefs[key] },
                onCastToDlna = { renderer ->
                    if (isOfflinePlayback) {
                        pendingOfflineRenderer = renderer
                        showOfflineCastWarning = true
                    } else {
                        viewModel.castToDlna(renderer)
                        showCastDialog = false
                    }
                },
                onCastToLan = { renderer ->
                    // Obsidian: la TV risolve in autonomia, no offline warning.
                    viewModel.castToLan(renderer)
                    showCastDialog = false
                },
                onCastToChromecast = { renderer ->
                    // Chromecast serve lo stream via il proxy locale (online): come il DLNA,
                    // l'offline non è direttamente raggiungibile dal ricevitore.
                    if (isOfflinePlayback) {
                        pendingOfflineChromecast = renderer
                        showOfflineCastWarning = true
                    } else {
                        viewModel.castToChromecast(renderer)
                        showCastDialog = false
                    }
                },
                onStopCast = {
                    viewModel.stopCast()
                    showCastDialog = false
                },
                onRefresh = { viewModel.discoverDlna() },
                onRemember = { key, protocol -> viewModel.rememberCastProtocol(key, protocol) },
                onDismiss = { showCastDialog = false }
            )
        }

        if (showOfflineCastWarning) {
            GlassAlertDialog(
                onDismissRequest = { showOfflineCastWarning = false },
                hazeState = playerHazeState,
                title = "Cast da offline",
                text = {
                    Text(
                        "Il contenuto è scaricato offline. La TV lo riprodurrà in streaming via internet, consumando dati di rete. Continuare?"
                    )
                },
                confirmButton = {
                    GlassDialogPrimaryButton(onClick = {
                        showOfflineCastWarning = false
                        showCastDialog = false
                        pendingOfflineRenderer?.let { viewModel.castToDlna(it, forceStreaming = true) }
                        pendingOfflineChromecast?.let { viewModel.castToChromecast(it, forceStreaming = true) }
                        pendingOfflineRenderer = null
                        pendingOfflineChromecast = null
                    }) {
                        Text("Continua")
                    }
                },
                dismissButton = {
                    GlassDialogNeutralButton(onClick = {
                        showOfflineCastWarning = false
                        pendingOfflineRenderer = null
                        pendingOfflineChromecast = null
                    }) {
                        Text("Annulla")
                    }
                }
            )
        }

        if (pendingCastSwitch != null) {
            GlassAlertDialog(
                onDismissRequest = { viewModel.cancelCastSwitch() },
                hazeState = playerHazeState,
                title = "Trasmissione già in corso",
                text = {
                    Text(
                        "È già in corso una trasmissione su un altro contenuto. Interromperla e avviare questa?"
                    )
                },
                confirmButton = {
                    GlassDialogDestructiveButton(onClick = {
                        viewModel.confirmCastSwitch()
                        showCastDialog = false
                    }) {
                        Text("Interrompi e avvia")
                    }
                },
                dismissButton = {
                    GlassDialogNeutralButton(onClick = { viewModel.cancelCastSwitch() }) {
                        Text("Annulla")
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
            // Normalizza un'altezza video grezza (es. 694) allo standard più
            // vicino (es. 720): gli stream non sempre rispettano le risoluzioni
            // canoniche, ma l'utente le riconosce solo in quella forma.
            fun nearestStandard(h: Int): Int =
                listOf(240, 360, 480, 720, 1080, 1440, 2160)
                    .minByOrNull { kotlin.math.abs(it - h) } ?: h

            GlassDialog(
                onDismissRequest = { settingsMenu = false },
                hazeState = playerHazeState,
                modifier = Modifier.width(360.dp)
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 12.dp)
                ) {
                        // "Auto" è sempre la prima opzione: annotato con la
                        // risoluzione che ABR sta usando (o la migliore nota se
                        // Media3 non ha ancora riportato una size) — ma solo
                        // quando si è effettivamente in modalità Auto adaptive.
                        // Se l'utente ha bloccato manualmente un variant, la
                        // risoluzione NON si mostra: solo "Auto".
                        val effectiveHeight = if (selectedVideoQuality == null) {
                            currentAutoHeight
                                ?: videoTracks.firstOrNull()
                                    ?.label?.removeSuffix("p")?.toIntOrNull()
                        } else null
                        val autoLabel = effectiveHeight
                            ?.let { "Auto (${nearestStandard(it)}p)" } ?: "Auto"
                        AnimatedContent(
                            targetState = settingsPanel,
                            transitionSpec = {
                                // Entrando in un sotto-pannello: scorre da destra.
                                // Tornando al menu principale: scorre da sinistra.
                                val forward = initialState == null
                                val dir = if (forward) 1 else -1
                                (slideInHorizontally(tween(220)) { w -> dir * w } + fadeIn(tween(220)))
                                    .togetherWith(
                                        slideOutHorizontally(tween(220)) { w -> -dir * w } + fadeOut(tween(220))
                                    )
                                    .using(SizeTransform(clip = false) { _, _ -> tween(220) })
                            },
                            label = "settingsPanel"
                        ) { panel ->
                          Column {
                            // Header fisso (solo nei sotto-pannelli): non scorre con la lista.
                            val panelTitle = when (panel) {
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
                            when (panel) {
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
                                    // "Auto" è sempre la prima opzione: etichetta
                                    // (autoLabel) calcolata sopra. "Massima" non appare
                                    // qui: è una preferenza che si sceglie in
                                    // Impostazioni e blocca il variant migliore.
                                    //
                                    // Evidenziazione:
                                    // - pref "auto" + nessun lock → riga Auto.
                                    // - pref cap (1080/720/480) → ABR sceglie entro il
                                    //   tetto; evidenziamo il track effettivamente
                                    //   riprodotto (match su currentAutoHeight, fallback
                                    //   al miglior track ≤ cap), NON la riga Auto.
                                    // - lock manuale (pref auto) → quel track.
                                    val capH = streamingLimit.toIntOrNull() ?: 0
                                    val isCap = capH > 0 && selectedVideoQuality == null
                                    // Altezza effettivamente riprodotta sotto il cap.
                                    val playingH = currentAutoHeight
                                        ?: videoTracks
                                            .mapNotNull { it.label.removeSuffix("p").toIntOrNull() }
                                            .filter { it <= capH }
                                            .maxOrNull()
                                    // In modalità cap evidenziamo il track più vicino
                                    // all'altezza riprodotta (currentAutoHeight può non
                                    // combaciare esattamente con l'altezza dichiarata del
                                    // variant, es. display aspect / arrotondamenti).
                                    val capTrackFormatId = if (isCap && playingH != null) {
                                        videoTracks.minByOrNull { t ->
                                            val h = t.label.removeSuffix("p").toIntOrNull() ?: 0
                                            kotlin.math.abs(h - playingH)
                                        }?.formatId
                                    } else null
                                    val autoSelected =
                                        selectedVideoQuality == null && streamingLimit == "auto"
                                    PlayerOptionRow(
                                        autoLabel,
                                        autoSelected
                                    ) {
                                        viewModel.setAutoVideoQuality()
                                        viewModel.setStreamingLimit("auto")
                                        settingsPanel = null
                                    }
                                    if (videoTracks.size > 1) {
                                        Spacer(modifier = Modifier.height(4.dp))
                                    }
                                    videoTracks.forEach { track ->
                                        val highlighted =
                                            selectedVideoQuality?.formatId == track.formatId ||
                                                track.formatId == capTrackFormatId
                                        PlayerOptionRow(
                                            track.label,
                                            highlighted
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
                                        // Preferenza qualità: nel main panel mostriamo la
                                        // risoluzione effettivamente riprodotta.
                                        // - "max": label del miglior track noto.
                                        // - cap (1080/720/480): ABR sceglie entro il tetto;
                                        //   mostriamo lo standard più vicino all'altezza
                                        //   effettiva (es. stream a 694p → "720p"), non il
                                        //   cap letterale né l'altezza grezza del variant.
                                        // - "auto" + lock manuale: solo "Auto" (no risoluzione).
                                        // - "auto" adaptive: "Auto (Xp)".
                                        when {
                                            streamingLimit == "max" ->
                                                videoTracks.firstOrNull()?.label ?: autoLabel
                                            streamingLimit == "1080" || streamingLimit == "720" ||
                                                streamingLimit == "480" -> {
                                                    val capH = streamingLimit.toIntOrNull() ?: 0
                                                    val playH = currentAutoHeight
                                                        ?: videoTracks
                                                            .mapNotNull {
                                                                it.label.removeSuffix("p").toIntOrNull()
                                                            }
                                                            .filter { it <= capH }
                                                            .maxOrNull()
                                                        ?: capH
                                                    "${nearestStandard(playH)}p"
                                            }
                                            // Preferenza "auto" con variant bloccato a mano:
                                            // nascondi la risoluzione (solo "Auto").
                                            selectedVideoQuality != null -> "Auto"
                                            else -> autoLabel
                                        },
                                        videoTracks.size > 1 || streamingLimit != "auto"
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
}

/** Raggruppa i renderer DLNA, Obsidian e Chromecast per IP in [CastDeviceGroup]. */
private fun buildCastDeviceGroups(
    dlna: List<DlnaRenderer>,
    streamo: List<LanRenderer>,
    chromecast: List<ChromecastRenderer>
): List<CastDeviceGroup> {
    val dlnaByIp = dlna.groupBy { normalizeIp(extractIp(it.controlUrl)) }
    val lanByIp = streamo.groupBy { normalizeIp(it.host) }
    // Chromecast con IP noto → raggruppato per IP; con IP null → gruppo a sé (chiave unica).
    val castWithIp = chromecast.filter { !it.ip.isNullOrBlank() }
        .groupBy { normalizeIp(it.ip!!) }
    val castNoIp = chromecast.filter { it.ip.isNullOrBlank() }

    val ips = linkedSetOf<String>()
    ips.addAll(dlnaByIp.keys)
    ips.addAll(lanByIp.keys)
    ips.addAll(castWithIp.keys)

    val byIp = ips.mapNotNull { ip ->
        val d = dlnaByIp[ip]?.firstOrNull()
        val s = lanByIp[ip]?.firstOrNull()
        val c = castWithIp[ip]?.firstOrNull()
        val name = s?.friendlyName ?: d?.friendlyName ?: c?.friendlyName ?: return@mapNotNull null
        CastDeviceGroup(ip = ip, name = name, dlnaRenderer = d, lanRenderer = s, chromecastRenderer = c)
    }
    // Chromecast senza IP ricavabile: una riga ciascuno (chiave IP fittizia per evitare
    // collisioni nella preferenza "ip|name").
    return byIp + castNoIp.mapIndexed { i, c ->
        CastDeviceGroup(ip = "_cc$i", name = c.friendlyName, dlnaRenderer = null, lanRenderer = null, chromecastRenderer = c)
    }
}

/** Estrae l'IP da un URL DLNA (es. "http://192.168.1.50:1033/..."). */
private fun extractIp(url: String): String {
    return try {
        val uri = java.net.URI(url)
        uri.host ?: url
    } catch (_: Exception) {
        url
    }
}

/**
 * Normalizza un host per il raggruppamento: minuscolo, senza parentesi IPv6 e senza
 * zone id ("fe80::1%wlan0" → "fe80::1"). Così l'IP DLNA (SSDP) e l'IP Obsidian (NSD)
 * dello stesso dispositivo combaciano e [CastDeviceGroup.hasBoth] funziona.
 */
private fun normalizeIp(host: String): String =
    host.trim().lowercase().removePrefix("[").substringBefore("]").substringBefore("%")

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

/** Badge "maschera IP" mostrato quando WARP è attivo. */
@Composable
private fun WarpBadge(modifier: Modifier = Modifier) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier.padding(horizontal = 12.dp, vertical = 6.dp)
    ) {
        val muted = Color.White.copy(alpha = 0.55f)
        Icon(
            imageVector = androidx.compose.material.icons.Icons.Filled.Lock,
            contentDescription = null,
            tint = muted,
            modifier = Modifier.size(14.dp)
        )
        Spacer(modifier = Modifier.width(6.dp))
        Text(text = "Maschera IP attiva (WARP)", color = muted, fontSize = 12.sp)
    }
}
