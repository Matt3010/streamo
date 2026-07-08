package com.streamo.app.ui.common

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutLinearInEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.HazeTint
import dev.chrisbanes.haze.hazeEffect
import kotlinx.coroutines.launch

/**
 * Bottom sheet draggabile in stile "glass", stessa ricetta delle altre modali
 * ([GlassDialog]): renderizzata fuori dalla `hazeSource` root tramite [LocalDialogHost]
 * così solo la superficie del foglio sfoca *davvero* lo sfondo dietro di sé (`hazeEffect`),
 * non l'intero schermo — a differenza di `ModalBottomSheet` di Material3, che disegna il
 * contenuto in una `Dialog` (finestra separata) dove il blur nativo di sistema
 * (`blurBehindRadius`) sfocherebbe tutta la finestra, non solo l'area dietro il foglio.
 * A riposo alto 3/4 schermo (si stringe se il contenuto è più corto). Trascinabile
 * dall'header: verso l'alto cresce fino a schermo intero meno la status bar (l'angolo/
 * maniglia in cima non ci finisce mai sotto). Da schermo intero, trascinare verso il
 * basso non chiude mai direttamente: si ferma sempre a 3/4; da lì un secondo
 * trascinamento verso il basso chiude. Il gesto non è limitato alla maniglia: vale su
 * tutto il corpo (es. una LazyColumn) quando è scrollato in cima — altrimenti scrolla
 * normalmente (vedi `bodyNestedScrollConnection`). Anche tap sullo scrim per chiudere.
 * In modalità prestazioni ([LocalReducedEffects]) fallback a fondo nero solid/semi-solid,
 * niente blur — come [GlassDialog].
 */
@Composable
fun GlassBottomSheet(
    onDismissRequest: () -> Unit,
    content: @Composable () -> Unit
) {
    val reduced = LocalReducedEffects.current
    val handle = remember { DialogHandle() }
    val currentOnDismiss by rememberUpdatedState(onDismissRequest)
    var finishedExit by remember { mutableStateOf(false) }

    // Quando l'animazione di uscita termina, notifica il chiamante una sola volta.
    LaunchedEffect(handle.visible.currentState, handle.visible.isIdle) {
        if (!finishedExit && !handle.visible.targetState && !handle.visible.currentState && handle.visible.isIdle) {
            finishedExit = true
            currentOnDismiss()
        }
    }

    val hazeState = LocalHazeState.current
    val host = LocalDialogHost.current
    val currentContent by rememberUpdatedState(content)

    if (host != null && hazeState != null) {
        DisposableEffect(Unit) {
            val remove = host.show { providedHazeState ->
                AnimatedVisibility(
                    visibleState = handle.visible,
                    enter = scrimEnter(reduced),
                    exit = scrimExit(reduced)
                ) {
                    GlassBottomSheetContent(
                        onAnimatedDismiss = { handle.visible.targetState = false },
                        hazeState = providedHazeState,
                        reduced = reduced,
                        handle = handle,
                        content = currentContent
                    )
                }
            }
            handle.remove = remove
            onDispose { handle.visible.targetState = false }
        }
    } else {
        AnimatedVisibility(
            visibleState = handle.visible,
            enter = scrimEnter(reduced),
            exit = scrimExit(reduced)
        ) {
            GlassBottomSheetContent(
                onAnimatedDismiss = { handle.visible.targetState = false },
                hazeState = hazeState,
                reduced = reduced,
                handle = null,
                content = currentContent
            )
        }
    }
}

@Composable
private fun AnimatedVisibilityScope.GlassBottomSheetContent(
    onAnimatedDismiss: () -> Unit,
    hazeState: HazeState?,
    reduced: Boolean,
    handle: DialogHandle?,
    content: @Composable () -> Unit
) {
    // Per il path host: rimuove l'entry dell'host dopo che l'uscita è terminata,
    // anche se il composable chiamante è già stato smontato.
    handle?.let { h ->
        LaunchedEffect(h.visible.currentState, h.visible.isIdle) {
            if (!h.visible.targetState && !h.visible.currentState && h.visible.isIdle) {
                h.remove?.invoke()
            }
        }
    }

    BackHandler(onBack = onAnimatedDismiss)

    val density = LocalDensity.current
    val statusBarDp = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
    val screenHeightDp = LocalConfiguration.current.screenHeightDp.dp
    // Riposo: 3/4 schermo. Trascinando verso l'alto cresce fino a schermo intero meno la
    // status bar, così l'angolo/maniglia in cima non ci finisce mai sotto.
    val partialHeightPx = with(density) { (screenHeightDp * 0.75f).toPx() }
    val expandedHeightPx = with(density) { (screenHeightDp - statusBarDp).toPx() }
    val scope = rememberCoroutineScope()
    // Altezza corrente del foglio in px: segue il dito in entrambe le direzioni,
    // poi al rilascio scatta sul più vicino fra {dismiss, 3/4, pieno}.
    val sheetHeight = remember { Animatable(partialHeightPx) }
    // Stato di riposo raggiunto dall'ultimo trascinamento. Da EXPANDED un trascinamento
    // verso il basso non chiude mai in un colpo solo: atterra prima su PARTIAL. Solo un
    // secondo trascinamento, partito già da PARTIAL, può chiudere il foglio.
    var anchor by remember { mutableStateOf(SheetAnchor.PARTIAL) }
    var dragStartAnchor by remember { mutableStateOf(SheetAnchor.PARTIAL) }

    // Atterra sul più vicino fra {dismiss, 3/4, pieno} in base a dove è partito il
    // trascinamento e alla velocità del rilascio. Condivisa fra la maniglia
    // ([draggable] qui sotto) e il nestedScroll del corpo (vedi bodyNestedScrollConnection).
    suspend fun settle(velocity: Float) {
        val midway = (partialHeightPx + expandedHeightPx) / 2f
        when (dragStartAnchor) {
            SheetAnchor.EXPANDED -> {
                if (sheetHeight.value >= expandedHeightPx - 1f) {
                    sheetHeight.animateTo(expandedHeightPx, tween(250))
                    anchor = SheetAnchor.EXPANDED
                } else {
                    sheetHeight.animateTo(partialHeightPx, tween(250))
                    anchor = SheetAnchor.PARTIAL
                }
            }
            SheetAnchor.PARTIAL -> when {
                sheetHeight.value < partialHeightPx * 0.5f || velocity > 1200f ->
                    onAnimatedDismiss()
                sheetHeight.value > midway || velocity < -1200f -> {
                    sheetHeight.animateTo(expandedHeightPx, tween(250))
                    anchor = SheetAnchor.EXPANDED
                }
                else -> {
                    sheetHeight.animateTo(partialHeightPx, tween(250))
                    anchor = SheetAnchor.PARTIAL
                }
            }
        }
    }

    // Estende il trascinamento della maniglia a tutto il corpo (es. una LazyColumn),
    // ma solo quando conta davvero: onPreScroll intercetta il trascinamento verso
    // l'alto PRIMA che il corpo scrolli, quindi finché il foglio non è a schermo
    // intero il corpo resta fermo in cima e cresce il foglio; onPostScroll riceve
    // solo il resto del trascinamento verso il basso che il corpo non ha potuto
    // consumare — cioè quando è già in cima e non ha più margine di scroll. Il
    // risultato: quando il contenuto è scrollato in mezzo, il gesto scrolla
    // normalmente; solo con contenuto in cima il gesto vale su tutta la modale.
    var bodyDraggingSheet by remember { mutableStateOf(false) }
    val bodyNestedScrollConnection = remember(expandedHeightPx) {
        object : NestedScrollConnection {
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                if (source != NestedScrollSource.UserInput) return Offset.Zero
                val dy = available.y
                if (dy >= 0f || sheetHeight.value >= expandedHeightPx) return Offset.Zero
                if (!bodyDraggingSheet) {
                    dragStartAnchor = anchor
                    bodyDraggingSheet = true
                }
                val current = sheetHeight.value
                val next = (current - dy).coerceIn(0f, expandedHeightPx)
                scope.launch { sheetHeight.snapTo(next) }
                return Offset(0f, current - next)
            }

            override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                if (source != NestedScrollSource.UserInput) return Offset.Zero
                val dy = available.y
                if (dy <= 0f) return Offset.Zero
                if (!bodyDraggingSheet) {
                    dragStartAnchor = anchor
                    bodyDraggingSheet = true
                }
                val current = sheetHeight.value
                val next = (current - dy).coerceIn(0f, expandedHeightPx)
                scope.launch { sheetHeight.snapTo(next) }
                return Offset(0f, current - next)
            }

            override suspend fun onPreFling(available: Velocity): Velocity {
                if (!bodyDraggingSheet) return Velocity.Zero
                bodyDraggingSheet = false
                settle(available.y)
                return available
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(Unit) { detectTapGestures { onAnimatedDismiss() } }
    ) {
        // Scrim esterno: velo scuro piatto, niente blur (segue solo il fade
        // dell'AnimatedVisibility esterna, come nelle altre modali).
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.55f))
        )

        // Superficie glass: stessa ricetta della navbar/dialog (hazeEffect reale +
        // tinta scura + bordo), applicata SOLO qui — non all'intero schermo.
        val cardSurfaceModifier = when {
            reduced || hazeState == null -> Modifier.background(GlassDefaults.SolidFill)
            else -> Modifier.hazeEffect(state = hazeState) {
                backgroundColor = Color.Black
                tints = listOf(HazeTint(GlassDefaults.DialogFill))
                blurRadius = GlassDefaults.BlurRadiusDialog
                noiseFactor = 0f
            }
        }

        Box(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .heightIn(max = with(density) { sheetHeight.value.toDp() })
                .pointerInput(Unit) { detectTapGestures { /* consuma, non chiudere */ } }
                .animateEnterExit(
                    enter = sheetCardEnter(reduced),
                    exit = sheetCardExit(reduced)
                )
                .clip(RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp))
                .then(cardSurfaceModifier)
        ) {
            // Stesso gesto della maniglia, condiviso via LocalSheetDragModifier con righe
            // statiche del contenuto (es. l'header con la "X") che il nestedScroll del
            // corpo non copre perché non scrollano.
            val sheetDragModifier = Modifier.draggable(
                orientation = Orientation.Vertical,
                state = rememberDraggableState { delta ->
                    scope.launch {
                        // delta > 0 = dito verso il basso → restringe;
                        // delta < 0 = dito verso l'alto → cresce.
                        val next = (sheetHeight.value - delta)
                            .coerceIn(0f, expandedHeightPx)
                        sheetHeight.snapTo(next)
                    }
                },
                onDragStarted = { dragStartAnchor = anchor },
                onDragStopped = { velocity -> scope.launch { settle(velocity) } }
            )

            Column(modifier = Modifier.navigationBarsPadding()) {
                // Maniglia sempre trascinabile. Il corpo sotto (bodyNestedScrollConnection)
                // guida lo stesso gesto solo quando è scrollato in cima; altrimenti scrolla
                // normalmente.
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 10.dp)
                        .then(sheetDragModifier),
                    contentAlignment = Alignment.Center
                ) {
                    Box(
                        modifier = Modifier
                            .size(width = 32.dp, height = 4.dp)
                            .clip(RoundedCornerShape(50))
                            .background(Color.White.copy(alpha = 0.4f))
                    )
                }
                Box(modifier = Modifier.nestedScroll(bodyNestedScrollConnection)) {
                    CompositionLocalProvider(LocalSheetDragModifier provides sheetDragModifier) {
                        content()
                    }
                }
            }
        }
    }
}

private enum class SheetAnchor { PARTIAL, EXPANDED }

/**
 * Modifier draggable della maniglia, esposto al [content] così righe statiche (es.
 * l'header con la "X" di chiusura) possano condividere lo stesso gesto: non essendo
 * scrollabili non generano eventi di nested scroll, quindi `bodyNestedScrollConnection`
 * da solo non le copre. Null fuori da [GlassBottomSheetContent].
 */
val LocalSheetDragModifier = compositionLocalOf<Modifier?> { null }

private fun sheetCardEnter(reduced: Boolean): EnterTransition =
    if (reduced) {
        EnterTransition.None
    } else {
        slideInVertically(
            initialOffsetY = { it },
            animationSpec = tween(280, easing = FastOutSlowInEasing)
        ) + fadeIn(tween(220))
    }

private fun sheetCardExit(reduced: Boolean): ExitTransition =
    if (reduced) {
        ExitTransition.None
    } else {
        slideOutVertically(
            targetOffsetY = { it },
            animationSpec = tween(200, easing = FastOutLinearInEasing)
        ) + fadeOut(tween(180))
    }
