package com.streamo.app.ui.common

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue

/**
 * Stato di press-feedback condiviso: scale + elevation + tint. Reduce-aware.
 * Valori non animati (fermi a riposo) quando [LocalReducedEffects] è attivo.
 */
class PressFeedback(val scale: Float, val elevation: Float, val tint: Float)

/**
 * Press-feedback unificato per card/elementi tappabili mobile: scale + shadow
 * elevation + tint bianca. Rispetta [LocalReducedEffects]: con la modalità
 * prestazioni attiva niente animazione (scale=1, elevation=0, tint=0).
 *
 * Ricetta unica condivisa da [MediaCard] e [ProgressMediaCard] — risolve
 * l'inconsistenza fra scale-only e scale+elevation+tint.
 */
@Composable
fun rememberPressFeedback(
    interactionSource: InteractionSource,
    pressedScale: Float = 0.94f,
    pressedElevation: Float = 12f,
    pressedTint: Float = 0.18f,
    scaleDampingRatio: Float = 0.65f,
    scaleStiffness: Float = 350f
): PressFeedback {
    val reduced = LocalReducedEffects.current
    val pressed by interactionSource.collectIsPressedAsState()
    val active = !reduced && pressed
    val scale by animateFloatAsState(
        targetValue = if (active) pressedScale else 1f,
        animationSpec = if (reduced) snap()
        else spring(dampingRatio = scaleDampingRatio, stiffness = scaleStiffness, visibilityThreshold = 0.001f),
        label = "pfScale"
    )
    val elevation by animateFloatAsState(
        targetValue = if (active) pressedElevation else 0f,
        animationSpec = if (reduced) snap()
        else spring(dampingRatio = 0.7f, stiffness = 300f, visibilityThreshold = 0.1f),
        label = "pfElev"
    )
    val tint by animateFloatAsState(
        targetValue = if (active) pressedTint else 0f,
        animationSpec = if (reduced) snap()
        else spring(dampingRatio = 0.8f, stiffness = 400f, visibilityThreshold = 0.01f),
        label = "pfTint"
    )
    return PressFeedback(scale, elevation, tint)
}