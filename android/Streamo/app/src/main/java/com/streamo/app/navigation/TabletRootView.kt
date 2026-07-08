package com.streamo.app.navigation

import android.app.Activity
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Animation
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.outlined.Animation
import androidx.compose.material.icons.outlined.Bookmark
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.NavigationRailItemDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.windowsizeclass.WindowSizeClass
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.streamo.app.player.cast.CastBannerViewModel
import com.streamo.app.ui.common.AmbientBackground
import com.streamo.app.ui.common.DialogHostState
import com.streamo.app.ui.common.GlassDefaults
import com.streamo.app.ui.common.LocalDialogHost
import com.streamo.app.ui.common.LocalHazeState
import com.streamo.app.ui.common.LocalReducedEffects
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.hazeSource

// Tab usati dal NavigationRail laterale (tablet landscape). Il set coincide con
// quello di [GlassBottomBar] in portrait ma è dichiarato separato per non
// accoppiare i due renderer: la pillola scorrevole e il rail non condividono
// comunque stato visivo.
private sealed class RailTab(
    val route: NavRoutes,
    val title: String,
    val selectedIcon: ImageVector,
    val unselectedIcon: ImageVector
) {
    data object Home : RailTab(NavRoutes.Home, "Home", Icons.Filled.Home, Icons.Outlined.Home)
    data object Search : RailTab(NavRoutes.Search, "Cerca", Icons.Filled.Search, Icons.Outlined.Search)
    data object Anime : RailTab(NavRoutes.Anime, "Anime", Icons.Filled.Animation, Icons.Outlined.Animation)
    data object Watchlist : RailTab(NavRoutes.Watchlist, "Lista", Icons.Filled.Bookmark, Icons.Outlined.Bookmark)
}

private val railTabs = listOf(RailTab.Home, RailTab.Search, RailTab.Anime, RailTab.Watchlist)

/**
 * Tablet shell: si adatta all'orientamento del device.
 *  - Portrait: come il telefono — AppNavHost con la [GlassBottomBar] fluttuante
 *    in basso. `LocalBottomBarPadding` viene fornito perché gli screen
 *    scrollabili lo sommano al loro contentPadding.
 *  - Landscape: NavigationRail fissa a sinistra, contenuto a destra (storico
 *    introdotto dal fix Android 7).
 *  - Player: chrome (rail E navbar) nascosti, fullscreen.
 *  Haze, dialog host e cast banner sono condivisi fra le due modalità.
 */
@Composable
fun TabletRootView(windowSizeClass: WindowSizeClass) {
    val navController = rememberNavController()
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = navBackStackEntry?.destination

    val isPlayer = currentDestination?.hierarchy?.any {
        it.hasRoute(NavRoutes.Player::class)
    } == true
    val chromeVisible = !isPlayer

    // Orientamento posseduto dal parent stabile (questo composable NON viene
    // disposto su rotazione, a differenza delle shell e del PlayerScreen che
    // vengono swappate). Nel player blocchiamo il landscape; fuori dal player
    // il tablet torna a rotazione libera. Keyed su isPlayer → niente race con
    // l'enter/dispose del PlayerScreen.
    val context = LocalContext.current
    LaunchedEffect(isPlayer) {
        (context as? Activity)?.requestedOrientation = if (isPlayer)
            ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        else ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    }

    val isPortrait = LocalConfiguration.current.orientation ==
        Configuration.ORIENTATION_PORTRAIT

    val hazeState = remember { HazeState() }
    val dialogHost = remember { DialogHostState() }

    if (isPortrait) {
        TabletPortraitShell(
            navController = navController,
            currentDestination = currentDestination,
            hazeState = hazeState,
            dialogHost = dialogHost,
            chromeVisible = chromeVisible
        )
    } else {
        TabletLandscapeShell(
            navController = navController,
            currentDestination = currentDestination,
            hazeState = hazeState,
            dialogHost = dialogHost,
            chromeVisible = chromeVisible
        )
    }
}

/**
 * Layout tablet portrait: replica del pattern phone con la [GlassBottomBar]
 * in basso. `barHeightPx` viene misurato per esporre [LocalBottomBarPadding]
 * agli screen che scrollano (altrimenti l'ultimo elemento resta coperto).
 */
@Composable
private fun TabletPortraitShell(
    navController: androidx.navigation.NavHostController,
    currentDestination: androidx.navigation.NavDestination?,
    hazeState: HazeState,
    dialogHost: DialogHostState,
    chromeVisible: Boolean
) {
    var barHeightPx by remember { mutableStateOf(0) }
    val density = LocalDensity.current
    val bottomInset = if (chromeVisible) with(density) { barHeightPx.toDp() } else 0.dp
    // "Modalità prestazioni": disabilita lo slide della navbar.
    val reduced = LocalReducedEffects.current

    Box(modifier = Modifier.fillMaxSize()) {
        // Sorgente del blur: tutto ciò che sta sotto la barra glass.
        Box(modifier = Modifier.fillMaxSize().hazeSource(hazeState)) {
            AmbientBackground()

            // Contenuto a tutta altezza: scorre sotto la barra glass flottante.
            // Gli screen leggono LocalBottomBarPadding per lasciare margine a fine
            // scrolling così l'ultimo elemento non resta coperto.
            CompositionLocalProvider(
                LocalBottomBarPadding provides bottomInset,
                LocalHazeState provides hazeState,
                LocalDialogHost provides dialogHost
            ) {
                AppNavHost(
                    navController = navController,
                    modifier = Modifier.fillMaxSize()
                )
            }
        }

        if (chromeVisible) {
            // Banner trasmissione sopra la navbar (BottomCenter, con offset
            // bottomInset così non si sovrappone alla pillola).
            val castVm: CastBannerViewModel = hiltViewModel()
            val castSession by castVm.session.collectAsState()
            val castPlaying by castVm.isPlaying.collectAsState()
            castSession?.let { s ->
                CastBanner(
                    hazeState = hazeState,
                    dialogHost = dialogHost,
                    title = s.media.displayTitle,
                    tvName = s.rendererName,
                    isPlaying = castPlaying,
                    onClick = {
                        navController.navigate(
                            NavRoutes.Player(
                                s.media.tmdbId, s.media.mediaType, s.media.season,
                                s.media.episode, s.media.title, s.media.poster, s.media.releaseDate
                            )
                        )
                    },
                    onTogglePlay = { castVm.togglePlay() },
                    onStop = { castVm.stop() },
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = bottomInset)
                        .padding(12.dp)
                )
            }
        }

        // Navbar in basso, identica al telefono: slide dal basso quando
        // appare/sparisce (apertura/chiusura player). Renderizzata fuori dal
        // `if (chromeVisible)` così l'AnimatedVisibility può animare l'uscita.
        // Modalità prestazioni → None (istantanea).
        AnimatedVisibility(
            visible = chromeVisible,
            enter = if (reduced) EnterTransition.None else slideInVertically { it },
            exit = if (reduced) ExitTransition.None else slideOutVertically { it },
            modifier = Modifier.align(Alignment.BottomCenter)
        ) {
            GlassBottomBar(
                hazeState = hazeState,
                modifier = Modifier.onSizeChanged { barHeightPx = it.height },
                selectedRoute = { tab ->
                    currentDestination?.hierarchy?.any { it.hasRoute(tab.route::class) } == true
                },
                onSelect = { tab ->
                    // Tab già attivo in cima allo stack: no-op (vedi RootTabView).
                    if (currentDestination?.hasRoute(tab.route::class) == true) return@GlassBottomBar
                    navController.navigate(tab.route) {
                        popUpTo(navController.graph.findStartDestination().id) {
                            saveState = true
                        }
                        launchSingleTop = true
                        restoreState = true
                    }
                }
            )
        }

        // Modali glass: fuori dalla hazeSource root così possono sfocare
        // l'app sottostante come la navbar. Dopo la navbar in z-order, così un
        // bottom sheet alto la copre invece di finirci sotto.
        dialogHost.dialogs.forEach { dialog ->
            dialog.content(hazeState)
        }
    }
}

/**
 * Layout tablet landscape: NavigationRail a sinistra, AppNavHost a destra.
 * Invariato rispetto alla versione introdotta dal fix Android 7. Il banner
 * cast va in alto a destra (non c'è navbar sotto a coprirlo).
 */
@Composable
private fun TabletLandscapeShell(
    navController: androidx.navigation.NavHostController,
    currentDestination: androidx.navigation.NavDestination?,
    hazeState: HazeState,
    dialogHost: DialogHostState,
    chromeVisible: Boolean
) {
    // "Modalità prestazioni": disabilita il crossfade colore dei tab del rail.
    val reduced = LocalReducedEffects.current
    Row(modifier = Modifier.fillMaxSize()) {
        if (chromeVisible) {
            NavigationRail(
                modifier = Modifier.fillMaxHeight(),
                containerColor = Color.Transparent,
                contentColor = Color.White,
                windowInsets = WindowInsets(0, 0, 0, 0)
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxHeight()
                        .windowInsetsPadding(WindowInsets.systemBars)
                        .padding(vertical = 8.dp)
                ) {
                    Column(
                        modifier = Modifier.fillMaxHeight(),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Spacer(modifier = Modifier.height(8.dp))
                        railTabs.forEach { tab ->
                            val selected = currentDestination?.hierarchy?.any {
                                it.hasRoute(tab.route::class)
                            } == true
                            val accent = MaterialTheme.colorScheme.primary
                            val contentColor = rememberTabContentColor(selected, accent, reduced)
                            NavigationRailItem(
                                icon = {
                                    Icon(
                                        imageVector = if (selected) tab.selectedIcon else tab.unselectedIcon,
                                        contentDescription = tab.title,
                                        tint = contentColor,
                                        modifier = Modifier.size(24.dp)
                                    )
                                },
                                label = {
                                    Text(
                                        text = tab.title,
                                        color = contentColor,
                                        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                                        fontSize = 11.sp,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                },
                                selected = selected,
                                onClick = {
                                    // Tab già attivo in cima allo stack: no-op (vedi RootTabView).
                                    if (currentDestination?.hasRoute(tab.route::class) == true) return@NavigationRailItem
                                    navController.navigate(tab.route) {
                                        popUpTo(navController.graph.findStartDestination().id) {
                                            saveState = true
                                        }
                                        launchSingleTop = true
                                        restoreState = true
                                    }
                                },
                                colors = NavigationRailItemDefaults.colors(
                                    selectedIconColor = accent,
                                    unselectedIconColor = Color.White.copy(alpha = GlassDefaults.MutedContentAlpha),
                                    selectedTextColor = accent,
                                    unselectedTextColor = Color.White.copy(alpha = GlassDefaults.MutedContentAlpha),
                                    // Indicatore Material standard della NavigationRailItem: alpha
                                    // più bassa (0.15) della pillola custom della bottom bar (0.22,
                                    // GlassDefaults.AccentTintAlpha) perché qui è un componente
                                    // diverso — verificato visivamente (audit 2026-07), non un refuso.
                                    indicatorColor = accent.copy(alpha = 0.15f)
                                )
                            )
                        }
                    }
                }
            }
        }

        Box(modifier = Modifier.weight(1f).fillMaxHeight()) {
            Box(modifier = Modifier.fillMaxSize().hazeSource(hazeState)) {
                AmbientBackground()

                CompositionLocalProvider(
                    LocalHazeState provides hazeState,
                    LocalDialogHost provides dialogHost
                ) {
                    AppNavHost(
                        navController = navController,
                        modifier = Modifier.fillMaxSize()
                    )
                }
            }

            dialogHost.dialogs.forEach { dialog ->
                dialog.content(hazeState)
            }

            if (chromeVisible) {
                val castVm: CastBannerViewModel = hiltViewModel()
                val castSession by castVm.session.collectAsState()
                val castPlaying by castVm.isPlaying.collectAsState()
                castSession?.let { s ->
                    CastBanner(
                        hazeState = hazeState,
                        dialogHost = dialogHost,
                        title = s.media.displayTitle,
                        tvName = s.rendererName,
                        isPlaying = castPlaying,
                        onClick = {
                            navController.navigate(
                                NavRoutes.Player(
                                    s.media.tmdbId, s.media.mediaType, s.media.season,
                                    s.media.episode, s.media.title, s.media.poster, s.media.releaseDate
                                )
                            )
                        },
                        onTogglePlay = { castVm.togglePlay() },
                        onStop = { castVm.stop() },
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .padding(16.dp)
                    )
                }
            }
        }
    }
}

// `Arrangement` importato in cima (serve per spacedBy del rail).
// CastBanner condiviso: vedi navigation/CastBanner.kt
