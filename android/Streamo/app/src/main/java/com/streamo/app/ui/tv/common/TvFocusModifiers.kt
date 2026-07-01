package com.streamo.app.ui.tv.common

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Core TV focus primitive. Wraps a focusable + clickable [Box] and hands the
 * current focus state to [content] so the caller can draw its own highlight
 * (background, border, color shift). On D-pad TV, *every* actionable element
 * must show a visible focus state — use this instead of a bare `Modifier.clickable`.
 *
 * - `scaleOnFocus`: gentle grow on focus (1f disables).
 * - `focusRequester`: attach to drive initial focus (`requestFocus()` in a LaunchedEffect).
 */
@Composable
fun TvFocusable(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    focusRequester: FocusRequester? = null,
    scaleOnFocus: Float = 1f,
    interactionSource: MutableInteractionSource? = null,
    content: @Composable (focused: Boolean) -> Unit
) {
    val interaction = interactionSource ?: remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val scale by animateFloatAsState(
        targetValue = if (focused) scaleOnFocus else 1f,
        animationSpec = tween(durationMillis = 150),
        label = "tvFocusableScale"
    )
    Box(
        modifier = modifier
            .then(if (focusRequester != null) Modifier.focusRequester(focusRequester) else Modifier)
            .then(if (scaleOnFocus != 1f) Modifier.scale(scale) else Modifier)
            .clickable(
                interactionSource = interaction,
                indication = null,
                enabled = enabled,
                onClick = onClick
            )
    ) {
        content(focused)
    }
}

/**
 * Animated 1.08× scale for the focused state. Kept for callers that already
 * track focus via `onFocusChanged`.
 */
@Composable
fun tvFocusScale(isFocused: Boolean): Float {
    return animateFloatAsState(
        targetValue = if (isFocused) 1.08f else 1f,
        animationSpec = tween(durationMillis = 200),
        label = "tvFocusScale"
    ).value
}

/**
 * Focus frame for poster/still cards. Draws the white ring in a 3dp inset gutter
 * AROUND the content (never over it), so the progress bar and corner badges stay
 * fully visible when focused. The 3dp padding is always reserved (border or not)
 * to avoid any layout shift on focus.
 *
 * Apply [Modifier.scale] BEFORE this so the ring scales together with the content.
 * The inner content should clip itself with a slightly smaller corner radius
 * (e.g. 9.dp against this 12.dp) for concentric rounding.
 */
fun Modifier.tvFocusFrame(
    focused: Boolean,
    shape: Shape = RoundedCornerShape(12.dp)
): Modifier = this
    .clip(shape)
    .then(if (focused) Modifier.border(3.dp, Color.White, shape) else Modifier)
    .padding(3.dp)

/**
 * Thin white focus ring for chips/rows/dialog buttons that already manage their
 * own background and padding (unlike [tvFocusFrame], no gutter is reserved, so
 * apply this last — after `.clip(shape)` and `.background(...)` — so the ring
 * draws on the outer edge and stays visible even when a "selected" fill would
 * otherwise make focused vs. unfocused indistinguishable).
 */
fun Modifier.tvFocusRing(
    focused: Boolean,
    shape: Shape,
    width: Dp = 2.dp,
    color: Color = Color.White
): Modifier = if (focused) this.border(width, color, shape) else this
