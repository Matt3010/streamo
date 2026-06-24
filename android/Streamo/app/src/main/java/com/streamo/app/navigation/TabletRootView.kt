package com.streamo.app.navigation

import android.app.Activity
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cast
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.outlined.Bookmark
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import com.streamo.app.ui.common.GlassAlertDialog
import com.streamo.app.ui.common.GlassDefaults
import com.streamo.app.ui.common.GlassDialogDestructiveButton
import com.streamo.app.ui.common.GlassDialogNeutralButton
import com.streamo.app.ui.common.LocalDialogHost
import com.streamo.app.ui.common.LocalHazeState
import com.streamo.app.ui.common.glassCapsule
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
    data object Watchlist : RailTab(NavRoutes.Watchlist, "Lista", Icons.Filled.Bookmark, Icons.Outlined.Bookmark)
}

private val railTabs = listOf(RailTab.Home, RailTab.Search, RailTab.Watchlist)

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

        // Modali glass: fuori dalla hazeSource root così possono sfocare
        // l'app sottostante come la navbar.
        dialogHost.dialogs.forEach { dialog ->
            dialog.content(hazeState)
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

            // Navbar in basso, identica al telefono.
            GlassBottomBar(
                hazeState = hazeState,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .onSizeChanged { barHeightPx = it.height },
                selectedRoute = { tab ->
                    currentDestination?.hierarchy?.any { it.hasRoute(tab.route::class) } == true
                },
                onSelect = { tab ->
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
                        .windowInsetsPadding(WindowInsets.navigationBars)
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
                            val contentColor by animateColorAsState(
                                targetValue = if (selected) accent else Color.White.copy(alpha = 0.6f),
                                label = "railTabContent"
                            )
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
                                    unselectedIconColor = Color.White.copy(alpha = 0.6f),
                                    selectedTextColor = accent,
                                    unselectedTextColor = Color.White.copy(alpha = 0.6f),
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

@Composable
private fun CastBanner(
    hazeState: HazeState,
    dialogHost: DialogHostState,
    title: String,
    tvName: String,
    isPlaying: Boolean,
    onClick: () -> Unit,
    onTogglePlay: () -> Unit,
    onStop: () -> Unit,
    modifier: Modifier = Modifier
) {
    var showStopConfirm by remember { mutableStateOf(false) }
    Box(
        modifier = modifier
            .fillMaxWidth()
            .glassCapsule(hazeState, GlassDefaults.Shape)
    ) {
        Row(
            modifier = Modifier
                .clickable(onClick = onClick)
                .padding(start = 14.dp, top = 8.dp, bottom = 8.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Filled.Cast,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    color = Color.White,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 14.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = "Trasmissione su $tvName",
                    color = Color.White.copy(alpha = 0.65f),
                    fontSize = 12.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            IconButton(onClick = onTogglePlay) {
                Icon(
                    imageVector = if (isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                    contentDescription = if (isPlaying) "Pausa" else "Riprendi",
                    tint = Color.White
                )
            }
            IconButton(onClick = { showStopConfirm = true }) {
                Icon(
                    imageVector = Icons.Filled.Close,
                    contentDescription = "Interrompi",
                    tint = Color.White
                )
            }
        }
    }

    if (showStopConfirm) {
        CompositionLocalProvider(
            LocalHazeState provides hazeState,
            LocalDialogHost provides dialogHost
        ) {
            GlassAlertDialog(
                onDismissRequest = { showStopConfirm = false },
                title = "Interrompi trasmissione",
                text = { Text("Vuoi interrompere la trasmissione su $tvName?") },
                confirmButton = {
                    GlassDialogDestructiveButton(
                        onClick = {
                            showStopConfirm = false
                            onStop()
                        }
                    ) {
                        Text("Interrompi")
                    }
                },
                dismissButton = {
                    GlassDialogNeutralButton(onClick = { showStopConfirm = false }) {
                        Text("Annulla")
                    }
                }
            )
        }
    }
}
