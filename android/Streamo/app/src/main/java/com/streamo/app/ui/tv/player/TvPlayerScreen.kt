package com.streamo.app.ui.tv.player

import android.view.KeyEvent
import android.view.LayoutInflater
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
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
import androidx.compose.material.icons.filled.Lock
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
import androidx.compose.runtime.mutableLongStateOf
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.layout.ContentScale
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
import com.streamo.app.player.lancast.LanCastReceiver
import com.streamo.app.player.lancast.LanCommand
import com.streamo.app.player.lancast.LanStatus
import com.streamo.app.ui.player.PlayerViewModel
import com.streamo.app.ui.tv.common.TvFocusable
import com.streamo.app.util.Format
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

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
 *   (Obsidian cast): tmdbId, mediaType, season, episode, title, poster, releaseDate.
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
    val seekingManually by viewModel.seekingManually.collectAsState()
    val error by viewModel.error.collectAsState()
    val playbackEnded by viewModel.playbackEnded.collectAsState()
    val nextAvailable by viewModel.nextEpisodeAvailable.collectAsState()

    val audioTracks by viewModel.audioTracks.collectAsState()
    val subtitleTracks by viewModel.subtitleTracks.collectAsState()
    val videoTracks by viewModel.videoTracks.collectAsState()
    val selectedAudio by viewModel.selectedAudio.collectAsState()
    val selectedSubtitle by viewModel.selectedSubtitle.collectAsState()
    val selectedVideoQuality by viewModel.selectedVideoQuality.collectAsState()
    val streamingLimit by viewModel.streamingLimit.collectAsState()
    val currentAutoHeight by viewModel.currentAutoHeight.collectAsState()
    val playbackSpeed by viewModel.playbackSpeed.collectAsState()
    val sources by viewModel.sources.collectAsState()
    val currentSourceIndex by viewModel.currentSourceIndex.collectAsState()
    val currentSeason by viewModel.currentSeason.collectAsState()
    val currentEpisode by viewModel.currentEpisode.collectAsState()
    val episodeTitle by viewModel.episodeTitle.collectAsState()
    val warpEnabled by viewModel.warpEnabled.collectAsState()

    var controlsVisible by remember { mutableStateOf(true) }
    var showSettings by remember { mutableStateOf(false) }
    // null = main list; "subtitles"/"audio"/"speed"/"quality"/"aspect"/"server" = sub-panel
    var settingsPanel by remember { mutableStateOf<String?>(null) }
    var resizeMode by remember { mutableIntStateOf(AspectRatioFrameLayout.RESIZE_MODE_FIT) }
    // Bumped on every key press while controls are visible, to reset the auto-hide timer.
    var interactionTick by remember { mutableIntStateOf(0) }

    // Scrub state hoisted here (like the phone player) so the freeze-frame overlay and the
    // spinner can react to it: while scrubbing we show the last decoded frame frozen and the
    // timeline preview moves, but NO seek happens until the user releases the D-pad.
    var scrubbing by remember { mutableStateOf(false) }
    var scrubPositionMs by remember { mutableLongStateOf(0L) }
    // Posizione committata in attesa che il player la raggiunga (-1 = nessuna). Dopo il
    // commit lo scrub finisce ma `currentPosition` resta sul valore VECCHIO finché il seek
    // non atterra (il player era in pausa durante lo scrub e il polling lo aggiorna ~1s
    // dopo): senza questo, al rilascio la barra tornerebbe per un attimo al tempo originale
    // e poi salterebbe al nuovo punto. Teniamo la barra sul target finché non combaciano.
    var pendingSeekMs by remember { mutableLongStateOf(-1L) }
    // Direzione corrente dello scrub: 0 fermo, +1 destra, -1 sinistra. Aggiornata da ogni
    // evento tasto (down o autorepeat). Lo scrub è guidato dal root key-handler sia in
    // immersivo (controlli nascosti) sia con la seekbar focalizzata, così "tieni premuto =
    // scorri continuo" vale SEMPRE.
    var scrubDir by remember { mutableIntStateOf(0) }
    // Timestamp (uptime ms) dell'ultimo evento tasto di scrub ricevuto. Il rilascio si
    // rileva dall'ASSENZA di eventi per [SCRUB_IDLE_MS], NON da ACTION_UP: su molti
    // telecomandi TV (BT/IR) ogni autorepeat è una coppia DOWN/UP, quindi committare su UP
    // farebbe un seek per ogni repeat = scatti con caricamento. Modello allineato a Media3
    // DefaultTimeBar (commit a timeout).
    val lastScrubKeyMs = remember { mutableLongStateOf(0L) }
    // True solo quando è un HOLD confermato (stream di eventi fitti): da lì il ticker anima
    // lo scorrimento continuo e fluido. Un singolo tap NON lo attiva → resta un salto secco
    // istantaneo, niente "animazione" secondo per secondo.
    var scrubHold by remember { mutableStateOf(false) }
    // Conta gli eventi consecutivi a gap breve. Serve [HOLD_ENGAGE_STREAK] per confermare un
    // hold: così tap singolo / doppio tap restano salti discreti e non fanno partire il ticker.
    var scrubRepeatStreak by remember { mutableIntStateOf(0) }
    // Intervallo misurato tra due eventi consecutivi durante un hold: il rilascio = gap molto
    // più lungo di questo, così la barra si ferma quasi subito quando lasci il tasto (no overshoot).
    val scrubKeyIntervalMs = remember { mutableLongStateOf(0L) }
    // La seekbar segnala qui il proprio focus, così il root sa quando L/R = scrub vs navigazione.
    var seekbarFocused by remember { mutableStateOf(false) }
    // Reference to the PlayerView's TextureView so we can grab a frozen frame on scrub/seek.
    var playerViewRef by remember { mutableStateOf<PlayerView?>(null) }
    var frozenFrame by remember { mutableStateOf<android.graphics.Bitmap?>(null) }

    val captureFrame: () -> Unit = {
        val tv = playerViewRef?.videoSurfaceView as? android.view.TextureView
        if (tv != null && tv.width > 0 && tv.height > 0 && tv.isAvailable) {
            try {
                frozenFrame = tv.getBitmap(tv.width, tv.height)
            } catch (_: Exception) { /* surface non valida → fallback nero */ }
        }
    }

    // Mostra il frame congelato ogni volta che vedremmo nero/verde: durante lo scrub
    // (drag della timeline), durante un seek manuale (flush del decoder) o in rebuffer.
    val freezeVisible = (scrubbing || seekingManually || buffering) && !loading && error == null

    // Sgancia il frame congelato 150ms dopo che la riproduzione è di nuovo pronta.
    LaunchedEffect(scrubbing, seekingManually, buffering) {
        if (!scrubbing && !seekingManually && !buffering && frozenFrame != null) {
            delay(150)
            frozenFrame = null
        }
    }

    // Registra un evento tasto di scrub. Due regimi netti:
    //  - TAP (pressione discreta): salto SECCO e istantaneo di [TAP_SEEK_MS], niente animazione.
    //    Tap singolo = +1 salto, doppio tap = +2 salti (nessun bug di stato).
    //  - HOLD (tasto tenuto = stream di eventi a gap breve): dopo [HOLD_ENGAGE_STREAK] eventi
    //    consecutivi fitti passa al ticker che anima lo scorrimento continuo e fluido.
    // Il gap tra eventi distingue i due: breve = parte di un hold, lungo = pressione separata.
    // repeatCount NON è affidabile (molti telecomandi TV mandano coppie DOWN/UP con count 0).
    val maxPos = { if (duration > 0L) duration else Long.MAX_VALUE }
    val onScrubKey: (Int, Boolean) -> Unit = { dir, _ ->
        val now = android.os.SystemClock.uptimeMillis()
        if (!scrubbing) {
            captureFrame()
            val from = currentPosition.coerceIn(0L, maxPos())
            scrubPositionMs = (from + dir * TAP_SEEK_MS).coerceIn(0L, maxPos())
            scrubbing = true
            pendingSeekMs = -1L
            scrubHold = false
            scrubRepeatStreak = 0
            scrubKeyIntervalMs.longValue = 0L
            viewModel.beginScrub()
        } else {
            val gap = now - lastScrubKeyMs.longValue
            if (gap in 16L..250L) {
                // Evento fitto = parte di un hold.
                scrubKeyIntervalMs.longValue = gap
                scrubRepeatStreak++
                if (scrubRepeatStreak >= HOLD_ENGAGE_STREAK) {
                    scrubHold = true
                } else if (!scrubHold) {
                    // Ancora ambiguo (potrebbe essere doppio tap veloce): salto secco anche qui.
                    scrubPositionMs = (scrubPositionMs + dir * TAP_SEEK_MS).coerceIn(0L, maxPos())
                }
                // Da hold confermato in poi NON saltare: avanza il ticker.
            } else {
                // Gap lungo = pressione discreta separata: nuovo salto secco, azzera l'hold.
                scrubPositionMs = (scrubPositionMs + dir * TAP_SEEK_MS).coerceIn(0L, maxPos())
                scrubRepeatStreak = 0
                scrubHold = false
            }
        }
        scrubDir = dir
        lastScrubKeyMs.longValue = now
    }

    // Committa subito lo scrub corrente alla posizione di preview (es. un tasto non-L/R
    // interrompe lo scrub). Idempotente. Tiene la barra sul target (pendingSeekMs) finché
    // il player non raggiunge il nuovo punto, evitando il "rimbalzo" al tempo vecchio.
    val commitScrubNow: () -> Unit = {
        if (scrubbing) {
            val target = scrubPositionMs
            scrubbing = false
            scrubDir = 0
            pendingSeekMs = target
            viewModel.commitScrubTo(target)
        }
    }

    // Azzera il target in attesa quando il player lo raggiunge (tolleranza per il sync di
    // ExoPlayer CLOSEST_SYNC), con una rete di sicurezza temporale se il seek atterra lontano.
    LaunchedEffect(pendingSeekMs, currentPosition) {
        if (pendingSeekMs >= 0L) {
            if (kotlin.math.abs(currentPosition - pendingSeekMs) < 2_000L) {
                pendingSeekMs = -1L
            } else {
                delay(5_000)
                pendingSeekMs = -1L
            }
        }
    }

    // Posizione mostrata in timeline: la preview durante lo scrub, il target committato
    // finché il seek non atterra, altrimenti la posizione reale del player.
    val displayedPositionMs = when {
        scrubbing -> scrubPositionMs
        pendingSeekMs >= 0L -> pendingSeekMs
        else -> currentPosition
    }

    // Sessione di scrub: muove la barra di preview in modo continuo e fluido (ticker 50ms,
    // passo accelerato), indipendente dalla cadenza dei key-repeat. Il player resta in pausa
    // sul frame congelato. Due soglie sul gap dall'ultimo evento tasto:
    //  - advanceGap: oltre questa SMETTE di avanzare (la barra si ferma quasi subito al
    //    rilascio, niente overshoot);
    //  - commitGap: oltre questa committa il seek UNA volta.
    // Entrambe adattive: cortissime una volta che gli autorepeat fluiscono (≈ intervallo
    // misurato), lunghe (SCRUB_IDLE_MS) prima del primo repeat per coprirne il ritardo.
    // Niente dipendenza da ACTION_UP (su molti telecomandi TV è una coppia per ogni repeat).
    LaunchedEffect(scrubbing) {
        if (scrubbing) {
            var elapsed = 0L
            while (isActive) {
                delay(SCRUB_TICK_MS)
                val now = android.os.SystemClock.uptimeMillis()
                val gap = now - lastScrubKeyMs.longValue
                val interval = scrubKeyIntervalMs.longValue
                if (!scrubHold) {
                    // Regime TAP: nessuna animazione. La barra è già al salto secco; aspetta
                    // altri tap (che si accumulano) e committa quando gli eventi cessano.
                    // L'idle lungo copre il ritardo del primo autorepeat, così un hold non
                    // viene committato come tap prima che il ticker continuo possa partire.
                    if (gap > SCRUB_IDLE_MS) {
                        commitScrubNow()
                        break
                    }
                } else {
                    // Regime HOLD: scorrimento continuo animato + rilascio rapido (soglie strette).
                    val advanceGap = maxOf(interval + 40L, 80L)
                    val commitGap = maxOf(interval + 130L, 180L)
                    if (gap > commitGap) {
                        commitScrubNow()
                        break
                    }
                    if (scrubDir != 0 && duration > 0L && gap <= advanceGap) {
                        // Se un repeat atteso è già MANCATO (gap oltre la cadenza), il tasto è
                        // probabilmente appena rilasciato: avanza col passo minimo (accel 1) così
                        // la "coda" prima dello stop è impercettibile, niente overshoot di secondi.
                        val releasing = gap > interval
                        val step = if (releasing) scrubStepMs(0L, duration) else scrubStepMs(elapsed, duration)
                        scrubPositionMs = (scrubPositionMs + scrubDir * step).coerceIn(0L, duration)
                        elapsed += SCRUB_TICK_MS
                    }
                }
            }
        }
    }

    val rootFocus = remember { FocusRequester() }
    val playPauseFocus = remember { FocusRequester() }
    val settingsFocus = remember { FocusRequester() }
    val seekbarFocus = remember { FocusRequester() }

    // Auto-hide controls after 4s while playing, unless the settings overlay is open.
    LaunchedEffect(isPlaying, controlsVisible, showSettings, interactionTick, buffering, playbackEnded) {
        if (controlsVisible && isPlaying && !showSettings && !buffering && !playbackEnded) {
            delay(4000)
            controlsVisible = false
        }
    }

    // Keep the relevant element focused: settings list when open, the seek bar when the
    // controls are showing (timeline-first on TV, so Left/Right scrub immediately), the
    // Replay button once playback ends, the root key-catcher when immersive.
    // NOTA: loading/buffering non devono spostare il focus; se lo facessero, durante lo
    // scrub ExoPlayer passa spesso per STATE_BUFFERING e la richiesta ripetuta di focus
    // sulla seekbar può interrompere lo scrub a metà pressione (commit prematuro + loop).
    LaunchedEffect(controlsVisible, showSettings, settingsPanel, playbackEnded) {
        runCatching {
            when {
                showSettings -> settingsFocus.requestFocus()
                playbackEnded -> playPauseFocus.requestFocus()
                controlsVisible -> seekbarFocus.requestFocus()
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
            LanCastReceiver.updateStatus(
                LanStatus(
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

    // Ricezione comandi Obsidian cast dal telefono (transport mentre il player è aperto;
    // i Play quando la TV è ferma li gestisce il consumer globale in TvRootView).
    LaunchedEffect(Unit) {
        LanCastReceiver.commands.collect { cmd ->
            when (cmd) {
                is LanCommand.Play -> {
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
                // Mostra i controlli quando il telefono mette in pausa/riprende: in pausa
                // restano visibili (nessun auto-hide finché fermo), così il player riappare.
                is LanCommand.Pause -> { viewModel.player.pause(); controlsVisible = true }
                is LanCommand.Resume -> { viewModel.player.play(); controlsVisible = true }
                is LanCommand.Stop -> onBack()
                is LanCommand.Seek -> viewModel.player.seekTo(cmd.positionMs)
            }
        }
    }

    // Reporta stato riproduzione al server Obsidian.
    LaunchedEffect(isPlaying, currentPosition, duration) {
        LanCastReceiver.updateStatus(
            LanStatus(
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
                val nk = event.nativeKeyEvent
                val isRight = nk.keyCode == KeyEvent.KEYCODE_DPAD_RIGHT ||
                    nk.keyCode == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD
                val isLeft = nk.keyCode == KeyEvent.KEYCODE_DPAD_LEFT ||
                    nk.keyCode == KeyEvent.KEYCODE_MEDIA_REWIND

                // Settings overlay: lascia tutto al focus system della modale.
                if (showSettings) {
                    if (nk.action == KeyEvent.ACTION_DOWN) interactionTick++
                    return@onPreviewKeyEvent false
                }

                // --- Scrub L/R, valido in OGNI modalità (questo è il fix) ---
                // Il root possiede lo scrub: tenere premuto L/R fa scorrere la timeline in
                // modo continuo (frame congelato + barra) sia in immersivo sia con la seekbar
                // focalizzata. Ogni evento tasto (down/autorepeat) rinfresca lo scrub; il seek
                // parte da solo quando gli eventi smettono (timeout, vedi [onScrubKey]). NON si
                // usa ACTION_UP: su molti telecomandi TV arriva tra un autorepeat e l'altro.
                if (isRight || isLeft) {
                    // Ignora ACTION_UP per lo scrub: il commit è a timeout. Consuma se stiamo
                    // scrubbando, così l'UP non finisce alla navigazione del focus.
                    if (nk.action == KeyEvent.ACTION_UP) {
                        return@onPreviewKeyEvent scrubbing
                    }
                    if (nk.action != KeyEvent.ACTION_DOWN) return@onPreviewKeyEvent false

                    // Live (durata sconosciuta): nessuno scrub possibile, fallback ±10s.
                    if (duration <= 0L) {
                        if (nk.repeatCount == 0) {
                            reveal()
                            captureFrame()
                            if (isRight) viewModel.seekForward() else viewModel.seekBack()
                        }
                        interactionTick++
                        return@onPreviewKeyEvent true
                    }
                    val dir = if (isRight) 1 else -1
                    val isRepeat = nk.repeatCount > 0
                    when {
                        // Scrub già in corso (posseduto dal root): ogni down/repeat lo rinfresca
                        // e ne aggiorna la direzione.
                        scrubbing -> onScrubKey(dir, isRepeat)
                        // Immersivo: rivela i controlli e avvia lo scrub.
                        !controlsVisible -> { reveal(); onScrubKey(dir, isRepeat) }
                        // Controlli visibili con la seekbar focalizzata: avvia lo scrub.
                        seekbarFocused -> onScrubKey(dir, isRepeat)
                        // Altrimenti un bottone è focalizzato → L/R naviga: non consumare.
                        else -> { interactionTick++; return@onPreviewKeyEvent false }
                    }
                    interactionTick++
                    return@onPreviewKeyEvent true
                }

                if (nk.action != KeyEvent.ACTION_DOWN) return@onPreviewKeyEvent false

                // Tasto non-L/R durante uno scrub in corso (es. Up/Center): committa il seek
                // prima di processarlo, così il player non resta congelato in pausa.
                if (scrubbing) commitScrubNow()

                // Seekbar focalizzata: CENTER/ENTER fa play/pausa in modo DETERMINISTICO.
                // La seekbar è solo `focusable` (nessun onClick), quindi senza questo l'evento
                // cadrebbe non gestito e il play/pausa dipenderebbe dal default del PlayerView.
                if (controlsVisible && seekbarFocused &&
                    (nk.keyCode == KeyEvent.KEYCODE_DPAD_CENTER ||
                        nk.keyCode == KeyEvent.KEYCODE_ENTER)) {
                    viewModel.togglePlayPause()
                    interactionTick++
                    return@onPreviewKeyEvent true
                }

                // Controlli visibili / non-L/R: lascia navigare il focus system.
                if (controlsVisible) {
                    interactionTick++
                    return@onPreviewKeyEvent false
                }
                // Immersivo, non-L/R: Center/Up/Down rivelano i controlli.
                when (nk.keyCode) {
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
                playerViewRef = playerView
                playerView
            },
            update = { it.resizeMode = resizeMode },
            modifier = Modifier.fillMaxSize()
        )

        // Freeze-frame overlay: tiene l'ultimo frame sullo schermo durante scrub/seek/
        // rebuffer invece di mostrare nero, verde (flush del decoder) o lo spinner. Fallback
        // a nero solo se nessun frame è stato catturato (seek prima del primo frame).
        if (freezeVisible) {
            val bmp = frozenFrame
            if (bmp != null) {
                Image(
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

        // Buffering / loading spinner — nascosto quando il frame congelato copre già lo
        // schermo (scrub o seek), così l'utente vede un fermo-immagine, non un caricamento.
        if ((buffering || loading) && !freezeVisible) {
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
                // Durante loading/buffering non mostrare il tasto play/pausa: lo spinner
                // centrale copre già lo stato, altrimenti sembrerebbe "fermo".
                if (loading || buffering) {
                    // spinner overlay già centrato sopra
                } else if (playbackEnded) {
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
                            onClick = { captureFrame(); viewModel.seekBack() }
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
                            onClick = { captureFrame(); viewModel.seekForward() }
                        )
                    }
                }

                // Bottom: focusable seek bar (display only). Lo scrub L/R è gestito dal root
                // key-handler (vedi onPreviewKeyEvent del Box): qui la barra mostra la
                // posizione di preview durante lo scrub e riporta il proprio focus.
                TvSeekBar(
                    positionMs = displayedPositionMs,
                    durationMs = duration,
                    bufferedMs = bufferedPosition,
                    onFocusChanged = { seekbarFocused = it },
                    focusRequester = seekbarFocus,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .padding(horizontal = 48.dp, vertical = 32.dp)
                )

                // Badge "Maschera IP attiva (WARP)" — sopra la seek bar, lato sinistro.
                if (warpEnabled) {
                    TvWarpBadge(
                        modifier = Modifier
                            .align(Alignment.BottomStart)
                            .padding(bottom = 96.dp, start = 48.dp)
                    )
                }

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
                streamingLimit = streamingLimit,
                currentAutoHeight = currentAutoHeight,
                playbackSpeed = playbackSpeed,
                resizeMode = resizeMode,
                currentSourceIndex = currentSourceIndex,
                onOpenPanel = { settingsPanel = it },
                onSelectSubtitleOff = { viewModel.disableSubtitles(); settingsPanel = null },
                onSelectSubtitle = { viewModel.selectSubtitleTrack(it); settingsPanel = null },
                onSelectAudio = { viewModel.selectAudioTrack(it); settingsPanel = null },
                onSelectSpeed = { viewModel.setPlaybackSpeed(it); settingsPanel = null },
                onSelectAutoQuality = {
                    viewModel.setAutoVideoQuality()
                    viewModel.setStreamingLimit("auto")
                    settingsPanel = null
                },
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

// Normalizza un'altezza video grezza (es. 694) allo standard più vicino (es. 720):
// gli stream non sempre rispettano le risoluzioni canoniche, ma l'utente le
// riconosce solo in quella forma. Allineato al player phone.
private fun nearestStandard(h: Int): Int =
    listOf(240, 360, 480, 720, 1080, 1440, 2160)
        .minByOrNull { kotlin.math.abs(it - h) } ?: h

/**
 * Focusable seek bar for the remote (display only). The L/R scrub gesture is owned by the
 * parent's root key-handler (see the Box `onPreviewKeyEvent` in [TvPlayerScreen]) so that
 * "hold to scrub continuously" works in EVERY mode — immersive (controls hidden) and with
 * the bar focused alike. This composable only renders the timeline at [positionMs] (the
 * parent already substitutes the scrub-preview / pending-seek position there). It reports
 * its focus via [onFocusChanged] so the parent knows when L/R means scrub vs. focus
 * navigation. Up/Down fall through to the focus system.
 */
@Composable
private fun TvSeekBar(
    positionMs: Long,
    durationMs: Long,
    bufferedMs: Long,
    onFocusChanged: (Boolean) -> Unit,
    focusRequester: FocusRequester? = null,
    modifier: Modifier = Modifier
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val primary = MaterialTheme.colorScheme.primary

    LaunchedEffect(focused) { onFocusChanged(focused) }

    val displayPosition = positionMs
    val displaySeconds = (displayPosition / 1000).toInt()
    val durationSeconds = (durationMs / 1000).toInt()

    Column(
        modifier = modifier
            .then(if (focusRequester != null) Modifier.focusRequester(focusRequester) else Modifier)
            .focusable(interactionSource = interaction)
    ) {
        val progressFraction =
            if (durationMs > 0L) (displayPosition.toFloat() / durationMs).coerceIn(0f, 1f) else 0f
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
            Text(Format.time(displaySeconds.toDouble()), color = Color.White, fontSize = 13.sp)
            Text(Format.time(durationSeconds.toDouble()), color = Color.White, fontSize = 13.sp)
        }
    }
}

/** Periodo del ticker di scrub: ogni 50ms avanza la posizione di preview (20 step/sec). */
private const val SCRUB_TICK_MS = 50L

/** Salto secco e istantaneo di una singola pressione discreta del D-pad (no animazione). */
private const val TAP_SEEK_MS = 10_000L

/**
 * Eventi consecutivi a gap breve necessari per confermare un HOLD (e far partire il ticker
 * continuo). Tap singolo e doppio tap restano sotto soglia → salti discreti istantanei.
 */
private const val HOLD_ENGAGE_STREAK = 2

/**
 * Quanto restare in scrub senza ricevere eventi tasto prima di committare il seek. Deve
 * superare il ritardo del primo autorepeat di sistema (~400-500ms) per non committare mentre
 * il tasto è ancora premuto ma il primo repeat non è ancora arrivato. Allineato al modello
 * di Media3 DefaultTimeBar (timeout di stop-scrubbing).
 */
private const val SCRUB_IDLE_MS = 600L

/**
 * Passo (ms di video) avanzato per ogni tick di [SCRUB_TICK_MS] mentre il D-pad è tenuto
 * premuto. Parte lento per il controllo fine e accelera con la durata della pressione; la
 * base scala con la lunghezza del contenuto, così i film lunghi si attraversano in tempi
 * umani senza che le clip brevi schizzino via. Profilo simile a Jellyfin/Wholphin.
 */
private fun scrubStepMs(elapsedMs: Long, durationMs: Long): Long {
    val durMin = durationMs / 60_000L
    val base = when {
        durMin < 15 -> 150L
        durMin < 45 -> 300L
        durMin < 120 -> 500L
        else -> 800L
    }
    val accel = when {
        elapsedMs < 1200L -> 1L
        elapsedMs < 3000L -> 3L
        elapsedMs < 6000L -> 7L
        else -> 14L
    }
    return base * accel
}

/** Badge "maschera IP" mostrato quando WARP è attivo (sfondo scuro, regola CLAUDE.md). */
@Composable
private fun TvWarpBadge(modifier: Modifier = Modifier) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .clip(RoundedCornerShape(50))
            .background(Color.Black.copy(alpha = 0.55f))
            .padding(horizontal = 14.dp, vertical = 8.dp)
    ) {
        val muted = Color.White.copy(alpha = 0.7f)
        Icon(
            imageVector = Icons.Filled.Lock,
            contentDescription = null,
            tint = muted,
            modifier = Modifier.size(16.dp)
        )
        Spacer(modifier = Modifier.width(6.dp))
        Text(text = "Maschera IP attiva (WARP)", color = muted, fontSize = 13.sp)
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
    streamingLimit: String,
    currentAutoHeight: Int?,
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

    // "Auto" annotato con la risoluzione che ABR sta usando (o la migliore nota se
    // Media3 non ha ancora riportato una size) — ma solo in modalità Auto adaptive.
    // Se l'utente ha bloccato un variant a mano, mostra solo "Auto". Allineato al phone.
    val effectiveHeight = if (selectedVideoQuality == null) {
        currentAutoHeight
            ?: videoTracks.firstOrNull()?.label?.removeSuffix("p")?.toIntOrNull()
    } else null
    val autoLabel = effectiveHeight?.let { "Auto (${nearestStandard(it)}p)" } ?: "Auto"

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
                            // Evidenziazione allineata al phone:
                            // - pref "auto" + nessun lock → riga Auto.
                            // - pref cap (1080/720/480) → evidenzia il track effettivamente
                            //   riprodotto (match su currentAutoHeight, fallback al miglior
                            //   track ≤ cap), NON la riga Auto.
                            // - lock manuale → quel track.
                            val capH = streamingLimit.toIntOrNull() ?: 0
                            val isCap = capH > 0 && selectedVideoQuality == null
                            val playingH = currentAutoHeight
                                ?: videoTracks
                                    .mapNotNull { it.label.removeSuffix("p").toIntOrNull() }
                                    .filter { it <= capH }
                                    .maxOrNull()
                            val capTrackFormatId = if (isCap && playingH != null) {
                                videoTracks.minByOrNull { t ->
                                    val h = t.label.removeSuffix("p").toIntOrNull() ?: 0
                                    kotlin.math.abs(h - playingH)
                                }?.formatId
                            } else null
                            val autoSelected =
                                selectedVideoQuality == null && streamingLimit == "auto"
                            TvOptionRow(autoLabel, autoSelected, firstRowFocus, onSelectAutoQuality)
                            videoTracks.forEach { track ->
                                val highlighted =
                                    selectedVideoQuality?.formatId == track.formatId ||
                                        track.formatId == capTrackFormatId
                                TvOptionRow(
                                    track.label,
                                    highlighted
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
                                // Riassunto qualità allineato al phone:
                                // - "max": label del miglior track noto.
                                // - cap (1080/720/480): standard più vicino all'altezza
                                //   effettiva (es. 694p → "720p"), non il cap letterale.
                                // - "auto" + lock manuale: solo "Auto".
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
                                    selectedVideoQuality != null -> "Auto"
                                    else -> autoLabel
                                },
                                videoTracks.size > 1 || streamingLimit != "auto"
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
