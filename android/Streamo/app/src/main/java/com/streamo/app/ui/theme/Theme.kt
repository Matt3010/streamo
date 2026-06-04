package com.streamo.app.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val DarkColorScheme = darkColorScheme(
    primary = StreamoRed,
    onPrimary = Color.White,
    primaryContainer = StreamoRed.copy(alpha = 0.15f),
    onPrimaryContainer = StreamoRedBright,
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
fun StreamoTheme(
    accentColor: Color = StreamoRed,
    content: @Composable () -> Unit
) {
    val colorScheme = DarkColorScheme.copy(
        primary = accentColor,
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
        typography = StreamoTypography,
        content = content
    )
}
