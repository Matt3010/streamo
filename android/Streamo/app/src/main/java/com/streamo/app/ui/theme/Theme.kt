package com.streamo.app.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val DarkColorScheme = darkColorScheme(
    primary = BrandRed,
    onPrimary = Color.White,
    primaryContainer = BrandRed.copy(alpha = 0.15f),
    onPrimaryContainer = BrandRedBright,
    secondary = Color(0xFFB0B0B0),
    onSecondary = Color.White,
    secondaryContainer = DarkSurfaceVariant,
    onSecondaryContainer = Color.White,
    tertiary = Color(0xFFFFA726),
    onTertiary = Color.Black,
    background = DarkBackground,
    onBackground = Color.White,
    surface = DarkSurface,
    onSurface = Color.White,
    surfaceVariant = DarkSurfaceVariant,
    onSurfaceVariant = Color(0xFFB0B0B0),
    error = Color(0xFFFF5252),
    onError = Color.White,
    outline = Color.White.copy(alpha = 0.12f)
)

@Composable
fun AppTheme(
    accentColor: Color = BrandRed,
    content: @Composable () -> Unit
) {
    // Con accenti chiari (giallo, ciano…) il testo bianco non è leggibile:
    // scegliamo bianco o nero in base alla luminanza dell'accento.
    val onAccent = if (accentColor.luminance() > 0.5f) Color.Black else Color.White
    val colorScheme = DarkColorScheme.copy(
        primary = accentColor,
        onPrimary = onAccent,
        primaryContainer = accentColor.copy(alpha = 0.15f),
        onPrimaryContainer = accentColor.copy(alpha = 0.8f)
    )

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = false
            WindowCompat.getInsetsController(window, view).isAppearanceLightNavigationBars = false
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = AppTypography,
        content = content
    )
}
