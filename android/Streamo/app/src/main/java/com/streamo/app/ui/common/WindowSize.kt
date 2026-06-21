package com.streamo.app.ui.common

import androidx.compose.material3.windowsizeclass.WindowSizeClass
import androidx.compose.material3.windowsizeclass.WindowWidthSizeClass
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * CompositionLocal holding the [WindowSizeClass] for the current window.
 * Use [LocalWindowSizeClass.current] inside composables.
 */
val LocalWindowSizeClass = compositionLocalOf<WindowSizeClass> {
    error("WindowSizeClass not provided — wrap content in a WindowSizeClass provider")
}

/** True when the window is a tablet (Expanded width class). */
val WindowSizeClass.isTablet: Boolean
    get() = widthSizeClass == WindowWidthSizeClass.Expanded

/** True when the window is a tablet AND currently in landscape orientation. */
fun WindowSizeClass.isLandscapeTablet(orientation: Int): Boolean =
    isTablet && orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE

/** True when the window is a tablet AND currently in portrait orientation. */
fun WindowSizeClass.isPortraitTablet(orientation: Int): Boolean =
    isTablet && orientation == android.content.res.Configuration.ORIENTATION_PORTRAIT

/**
 * Adaptive card width based on window size class.
 * Phone portrait: 140dp | Phone landscape / small tablet: 150dp | Tablet: 180dp
 */
val WindowSizeClass.cardWidth: Dp
    @Composable get() = when (widthSizeClass) {
        WindowWidthSizeClass.Compact -> 140.dp
        WindowWidthSizeClass.Medium -> 150.dp
        WindowWidthSizeClass.Expanded -> 180.dp
        else -> 140.dp
    }

/**
 * Adaptive grid min column width. Controls how many columns fit in a grid.
 * Compact (phone): 140dp → ~2-3 cols | Medium: 150dp → ~4 cols | Expanded (tablet): 180dp → 6-12 cols
 */
val WindowSizeClass.gridMinSize: Dp
    @Composable get() = cardWidth

/**
 * Horizontal content padding based on window size class.
 * Compact: 16dp | Medium: 20dp | Expanded: 32dp
 */
val WindowSizeClass.contentPadding: Dp
    @Composable get() = when (widthSizeClass) {
        WindowWidthSizeClass.Compact -> 16.dp
        WindowWidthSizeClass.Medium -> 20.dp
        WindowWidthSizeClass.Expanded -> 32.dp
        else -> 16.dp
    }

/**
 * Spacing between grid/card items based on window size class.
 */
val WindowSizeClass.itemSpacing: Dp
    @Composable get() = when (widthSizeClass) {
        WindowWidthSizeClass.Compact -> 14.dp
        WindowWidthSizeClass.Medium -> 16.dp
        WindowWidthSizeClass.Expanded -> 20.dp
        else -> 14.dp
    }
