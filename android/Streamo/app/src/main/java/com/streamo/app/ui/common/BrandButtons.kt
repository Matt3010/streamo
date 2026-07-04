package com.streamo.app.ui.common

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp

/**
 * Stile bottoni "brand" condiviso (hero, Detail, …) — port di
 * `BrandButtonStyle` iOS: angoli arrotondati continui, non pill.
 */
object BrandButtonDefaults {
    /** Stesso raggio di [GlassDefaults.Shape]: un solo valore da cambiare. */
    val Shape = GlassDefaults.Shape
    val ContentPadding = PaddingValues(horizontal = 18.dp, vertical = 13.dp)
    val IconContentPadding = PaddingValues(horizontal = 14.dp, vertical = 13.dp)
}

/** CTA primario (rosso) con angoli arrotondati, stile copertina hero. */
@Composable
fun BrandButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit
) {
    val interactionSource = remember { MutableInteractionSource() }
    val pf = rememberPressFeedback(
        interactionSource = interactionSource,
        pressedScale = 0.96f,
        pressedElevation = 0f,
        pressedTint = 0f,
        scaleDampingRatio = 0.7f,
        scaleStiffness = 400f
    )

    Button(
        onClick = onClick,
        enabled = enabled,
        shape = BrandButtonDefaults.Shape,
        colors = ButtonDefaults.buttonColors(
            containerColor = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary
        ),
        contentPadding = BrandButtonDefaults.ContentPadding,
        modifier = modifier.scale(pf.scale),
        interactionSource = interactionSource,
        content = content
    )
}

/**
 * Bottone secondario "glass" chiaro semitrasparente con bordo sottile; diventa
 * primary quando [active] (es. titolo già in watchlist) — port del kind
 * `.secondary` iOS.
 */
@Composable
fun BrandSecondaryButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    active: Boolean = false,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit
) {
    val interactionSource = remember { MutableInteractionSource() }
    val pf = rememberPressFeedback(
        interactionSource = interactionSource,
        pressedScale = 0.96f,
        pressedElevation = 0f,
        pressedTint = 0f,
        scaleDampingRatio = 0.7f,
        scaleStiffness = 400f
    )

    Button(
        onClick = onClick,
        enabled = enabled,
        shape = BrandButtonDefaults.Shape,
        colors = if (active) {
            ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary
            )
        } else {
            ButtonDefaults.buttonColors(
                containerColor = Color.White.copy(alpha = 0.08f),
                contentColor = Color.White
            )
        },
        border = if (active) null else BorderStroke(1.dp, Color.White.copy(alpha = 0.12f)),
        contentPadding = BrandButtonDefaults.ContentPadding,
        modifier = modifier.scale(pf.scale),
        interactionSource = interactionSource,
        content = content
    )
}

/**
 * Bottone icona secondario "glass" chiaro semitrasparente con bordo sottile;
 * diventa primary quando [active] (es. titolo già in watchlist) — stile
 * copertina hero.
 */
@Composable
fun BrandIconButton(
    onClick: () -> Unit,
    icon: ImageVector,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    active: Boolean = false,
    enabled: Boolean = true
) {
    val interactionSource = remember { MutableInteractionSource() }
    val pf = rememberPressFeedback(
        interactionSource = interactionSource,
        pressedScale = 0.96f,
        pressedElevation = 0f,
        pressedTint = 0f,
        scaleDampingRatio = 0.7f,
        scaleStiffness = 400f
    )

    Button(
        onClick = onClick,
        enabled = enabled,
        shape = BrandButtonDefaults.Shape,
        colors = if (active) {
            ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary
            )
        } else {
            ButtonDefaults.buttonColors(
                containerColor = Color.White.copy(alpha = 0.08f),
                contentColor = Color.White
            )
        },
        border = if (active) null else BorderStroke(1.dp, Color.White.copy(alpha = 0.12f)),
        contentPadding = BrandButtonDefaults.IconContentPadding,
        modifier = modifier.scale(pf.scale),
        interactionSource = interactionSource
    ) {
        Icon(
            imageVector = icon,
            contentDescription = contentDescription
        )
    }
}

/**
 * Riga "ripristina predefinito" condivisa dalle schermate Impostazioni
 * (colore accento, chiave TMDB, lingua provider, dominio AnimeUnity, …):
 * contenitore vetro tenue, bordo quando attiva, testo error quando cliccabile.
 */
@Composable
fun ResetDefaultRow(
    label: String,
    isDefault: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val interactionSource = remember { MutableInteractionSource() }
    val pf = rememberPressFeedback(
        interactionSource = interactionSource,
        pressedScale = 0.96f,
        pressedElevation = 0f,
        pressedTint = 0f,
        scaleDampingRatio = 0.7f,
        scaleStiffness = 400f
    )
    Box(
        modifier = modifier
            .scale(pf.scale)
            .clip(GlassDefaults.Shape)
            .background(
                if (isDefault) Color.White.copy(alpha = 0.04f)
                else Color.White.copy(alpha = 0.08f)
            )
            .then(
                if (isDefault) Modifier
                else Modifier.border(1.dp, Color.White.copy(alpha = 0.12f), GlassDefaults.Shape)
            )
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                enabled = !isDefault,
                onClick = onClick
            )
            .padding(horizontal = 18.dp, vertical = 13.dp)
    ) {
        Text(
            label,
            style = MaterialTheme.typography.titleSmall,
            color = if (isDefault) MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f)
            else MaterialTheme.colorScheme.error
        )
    }
}
