package com.streamo.app.ui.common

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.core.FastOutLinearInEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.HazeTint
import dev.chrisbanes.haze.hazeEffect

/**
 * Host per modali glass. Le modali registrate qui vengono disegnate **fuori** dalla
 * `hazeSource` root, come fratello del contenuto dell'app: questo permette alla
 * superficie della modale di applicare `hazeEffect` e ottenere il blur reale della
 * navbar.
 *
 * Senza host, `GlassDialog` cade in un overlay inline (utile per preview/TV) con
 * vetro piatto.
 */
@Stable
class DialogHostState {
    private val _dialogs = mutableStateListOf<DialogEntry>()
    internal val dialogs: List<DialogEntry> get() = _dialogs

    internal data class DialogEntry(
        val content: @Composable (HazeState) -> Unit
    )

    /** Registra una modale. Restituisce una funzione da chiamare per rimuoverla. */
    fun show(content: @Composable (HazeState) -> Unit): () -> Unit {
        val entry = DialogEntry(content)
        _dialogs.add(entry)
        return { _dialogs.remove(entry) }
    }
}

/** Fornisce l'host delle modali. Definito in `RootTabView`. */
val LocalDialogHost = staticCompositionLocalOf<DialogHostState?> { null }

/**
 * Dialog di conferma/picker in stile glass con blur reale sulla superficie della
 * modale, come la navbar. Renderizzato fuori dalla `hazeSource` root tramite
 * l'host di `RootTabView`. Se l'host non è disponibile (preview / TV) usa un
 * overlay inline con vetro piatto.
 */
@Composable
fun GlassAlertDialog(
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    hazeState: HazeState? = LocalHazeState.current,
    icon: @Composable (() -> Unit)? = null,
    title: String? = null,
    text: @Composable (() -> Unit)? = null,
    confirmButton: @Composable (() -> Unit)? = null,
    dismissButton: @Composable (() -> Unit)? = null
) {
    GlassDialog(
        onDismissRequest = onDismissRequest,
        hazeState = hazeState,
        modifier = modifier
            .widthIn(min = 320.dp, max = 600.dp)
            .padding(horizontal = 24.dp)
    ) {
        Column(modifier = Modifier.padding(24.dp, 20.dp)) {
            icon?.let {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center
                ) {
                    it()
                }
            }

            title?.let {
                Text(
                    text = it,
                    color = Color.White,
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(bottom = if (text != null) 12.dp else 0.dp)
                )
            }

            text?.invoke()

            if (confirmButton != null || dismissButton != null) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 20.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    dismissButton?.invoke()
                    confirmButton?.invoke()
                }
            }
        }
    }
}

/** Bottone glass stretto per dialog: sfondo semitrasparente + bordo sottile, testo bianco. */
@Composable
fun GlassDialogNeutralButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        shape = GlassDefaults.Shape,
        colors = ButtonDefaults.buttonColors(
            containerColor = GlassDefaults.Container,
            contentColor = Color.White,
            disabledContainerColor = GlassDefaults.Container.copy(alpha = 0.5f),
            disabledContentColor = Color.White.copy(alpha = 0.38f)
        ),
        border = BorderStroke(1.dp, GlassDefaults.Border),
        contentPadding = PaddingValues(horizontal = 18.dp, vertical = 10.dp),
        content = content
    )
}

/** Bottone primary stretto per dialog. */
@Composable
fun GlassDialogPrimaryButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        shape = GlassDefaults.Shape,
        colors = ButtonDefaults.buttonColors(
            containerColor = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary,
            disabledContainerColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.38f),
            disabledContentColor = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.38f)
        ),
        border = null,
        contentPadding = PaddingValues(horizontal = 18.dp, vertical = 10.dp),
        content = content
    )
}

/** Bottone glass stretto per azioni distruttive: testo in error. */
@Composable
fun GlassDialogDestructiveButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        shape = GlassDefaults.Shape,
        colors = ButtonDefaults.buttonColors(
            containerColor = GlassDefaults.Container,
            contentColor = MaterialTheme.colorScheme.error,
            disabledContainerColor = GlassDefaults.Container.copy(alpha = 0.5f),
            disabledContentColor = MaterialTheme.colorScheme.error.copy(alpha = 0.38f)
        ),
        border = BorderStroke(1.dp, GlassDefaults.Border),
        contentPadding = PaddingValues(horizontal = 18.dp, vertical = 10.dp),
        content = content
    )
}

/**
 * Handle condiviso tra `GlassDialog` (padre) e il contenuto registrato nell'host.
 * Mantiene lo stato di transizione e il remove callback, così l'animazione di
 * uscita può completarsi anche se il composable chiamante abbandona la composizione.
 */
@Stable
private class DialogHandle {
    val visible = MutableTransitionState(false).apply { targetState = true }
    var remove: (() -> Unit)? = null
}

/**
 * Dialog generico in stile glass con animazioni di entrata/uscita (fade dello
 * scrim, scale/fade/slide della card). Rispetta [LocalReducedEffects] saltando le
 * animazioni.
 *
 * @param hazeState preferibilmente lo stesso [HazeState] del contenuto sottostante.
 *        Quando la modale viene renderizzata via [LocalDialogHost], questo è lo
 *        state passato dall'host (root). Default [LocalHazeState.current].
 */
@Composable
fun GlassDialog(
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    hazeState: HazeState? = LocalHazeState.current,
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

    val host = LocalDialogHost.current
    if (host != null && hazeState != null) {
        val currentModifier by rememberUpdatedState(modifier)
        val currentContent by rememberUpdatedState(content)
        val currentHaze by rememberUpdatedState(hazeState)
        DisposableEffect(Unit) {
            val remove = host.show { providedHazeState ->
                AnimatedVisibility(
                    visibleState = handle.visible,
                    enter = scrimEnter(reduced),
                    exit = scrimExit(reduced)
                ) {
                    GlassDialogContent(
                        onAnimatedDismiss = { handle.visible.targetState = false },
                        modifier = currentModifier,
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
            GlassDialogContent(
                onAnimatedDismiss = { handle.visible.targetState = false },
                modifier = modifier,
                hazeState = hazeState,
                reduced = reduced,
                content = content
            )
        }
    }
}

@Composable
private fun AnimatedVisibilityScope.GlassDialogContent(
    onAnimatedDismiss: () -> Unit,
    modifier: Modifier,
    hazeState: HazeState?,
    reduced: Boolean,
    handle: DialogHandle? = null,
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
    Box(
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(Unit) { detectTapGestures { onAnimatedDismiss() } },
        contentAlignment = Alignment.Center
    ) {
        // Scrim esterno: solo un velo scuro piatto per isolare la modale, niente blur.
        // Il blur glass deve vivere sulla superficie della modale, come la navbar.
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.55f))
        )

        // Card glass: stessa ricetta della navbar (hazeEffect sulla superficie + tinta
        // scura + bordo sottile). Renderizzata fuori dalla hazeSource root, quindi
        // sfocare davvero l'app sottostante.
        val cardSurfaceModifier = when {
            reduced || hazeState == null -> Modifier.background(GlassDefaults.SolidFill)
            else -> Modifier.hazeEffect(state = hazeState) {
                backgroundColor = Color.Black
                tints = listOf(HazeTint(Color.Black.copy(alpha = 0.55f)))
                blurRadius = GlassDefaults.BlurRadiusDialog
                noiseFactor = 0f
            }
        }
        Card(
            modifier = modifier
                .pointerInput(Unit) { detectTapGestures { /* consume */ } }
                .animateEnterExit(
                    enter = cardEnter(reduced),
                    exit = cardExit(reduced)
                ),
            shape = GlassDefaults.Shape,
            colors = CardDefaults.cardColors(
                containerColor = Color.Transparent,
                contentColor = Color.White
            ),
            border = BorderStroke(1.dp, GlassDefaults.Border)
        ) {
            // La superficie glass deve adattarsi al contenuto: fillMaxWidth per
            // estendere il blur su tutta la larghezza, ma wrap height per non
            // diventare full-height.
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .then(cardSurfaceModifier)
            ) {
                content()
            }
        }
    }
}

private fun scrimEnter(reduced: Boolean): EnterTransition =
    if (reduced) EnterTransition.None else fadeIn(tween(220))

private fun scrimExit(reduced: Boolean): ExitTransition =
    if (reduced) ExitTransition.None else fadeOut(tween(180))

private fun cardEnter(reduced: Boolean): EnterTransition =
    if (reduced) {
        EnterTransition.None
    } else {
        scaleIn(
            initialScale = 0.92f,
            animationSpec = tween(280, easing = FastOutSlowInEasing)
        ) + fadeIn(tween(220)) + slideInVertically(
            initialOffsetY = { it / 6 },
            animationSpec = tween(280, easing = FastOutSlowInEasing)
        )
    }

private fun cardExit(reduced: Boolean): ExitTransition =
    if (reduced) {
        ExitTransition.None
    } else {
        scaleOut(
            targetScale = 0.96f,
            animationSpec = tween(180, easing = FastOutLinearInEasing)
        ) + fadeOut(tween(180)) + slideOutVertically(
            targetOffsetY = { it / 8 },
            animationSpec = tween(180, easing = FastOutLinearInEasing)
        )
    }
