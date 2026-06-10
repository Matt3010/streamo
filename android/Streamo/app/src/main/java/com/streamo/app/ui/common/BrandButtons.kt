package com.streamo.app.ui.common

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp

/**
 * Stile bottoni "brand" condiviso (hero, Detail, …) — port di
 * `BrandButtonStyle` iOS: angoli arrotondati continui, non pill.
 */
object BrandButtonDefaults {
    val Shape = RoundedCornerShape(14.dp)
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
    Button(
        onClick = onClick,
        enabled = enabled,
        shape = BrandButtonDefaults.Shape,
        colors = ButtonDefaults.buttonColors(
            containerColor = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary
        ),
        contentPadding = BrandButtonDefaults.ContentPadding,
        modifier = modifier,
        content = content
    )
}

/**
 * Bottone secondario "glass" scuro con bordo sottile; diventa primary quando
 * [active] (es. titolo già in watchlist) — port del kind `.secondary` iOS.
 */
@Composable
fun BrandSecondaryButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    active: Boolean = false,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit
) {
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
        modifier = modifier,
        content = content
    )
}

/**
 * Bottone icona secondario "glass" scuro con bordo sottile; diventa primary
 * quando [active] (es. titolo già in watchlist) — stile copertina hero.
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
        modifier = modifier
    ) {
        Icon(
            imageVector = icon,
            contentDescription = contentDescription
        )
    }
}
