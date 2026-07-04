package com.streamo.app.navigation

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.streamo.app.player.cast.CastBannerViewModel
import com.streamo.app.ui.common.AmbientBackground
import com.streamo.app.ui.common.DialogHostState
import com.streamo.app.ui.common.LocalDialogHost
import com.streamo.app.ui.common.LocalHazeState
import com.streamo.app.ui.common.LocalReducedEffects
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.hazeSource

/**
 * Spazio in basso occupato dalla barra glass flottante (altezza barra + inset
 * di sistema). Gli screen scrollabili lo sommano al loro `contentPadding` bottom
 * così l'ultimo elemento non resta coperto a fine scrolling. 0.dp quando la barra
 * non è visibile (es. player).
 */
val LocalBottomBarPadding = compositionLocalOf { 0.dp }

@Composable
fun RootTabView() {
    val navController = rememberNavController()

    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = navBackStackEntry?.destination

    val bottomBarVisible = currentDestination?.hierarchy?.any {
        it.hasRoute(NavRoutes.Player::class)
    } != true

    var barHeightPx by remember { mutableStateOf(0) }
    val density = LocalDensity.current
    val bottomInset = if (bottomBarVisible) with(density) { barHeightPx.toDp() } else 0.dp
    val hazeState = remember { HazeState() }
    val dialogHost = remember { DialogHostState() }
    // "Modalità prestazioni": disabilita lo slide della navbar.
    val reduced = LocalReducedEffects.current

    Scaffold(
        contentWindowInsets = androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0)
    ) { _ ->
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

            // Modali glass: renderizzate fuori dalla hazeSource root così la loro
            // superficie può sfocare l'app sottostante come la navbar.
            dialogHost.dialogs.forEach { dialog ->
                dialog.content(hazeState)
            }

            // Banner trasmissione: visibile mentre si naviga l'app (non sul player),
            // se c'è un cast in corso. Cliccabile per tornare ai controlli.
            if (bottomBarVisible) {
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

            // Navbar glass: slide dal basso quando appare/sparisce (apertura/chiusura
            // player). Con la modalità prestazioni istantanea (None).
            AnimatedVisibility(
                visible = bottomBarVisible,
                enter = if (reduced) EnterTransition.None else slideInVertically { it },
                exit = if (reduced) ExitTransition.None else slideOutVertically { it },
                modifier = Modifier.align(Alignment.BottomCenter)
            ) {
                GlassBottomBar(
                    hazeState = hazeState,
                    modifier = Modifier.onSizeChanged { barHeightPx = it.height },
                    selectedRoute = { tab -> currentDestination?.hierarchy?.any { it.hasRoute(tab.route::class) } == true },
                    onSelect = { tab ->
                        // Tab già attivo in cima allo stack: no-op. Altrimenti il
                        // popUpTo+singoloTop ricrea la destinazione e riproduce la
                        // transizione di navigazione come se si riaprisse la pagina.
                        if (currentDestination?.hasRoute(tab.route::class) == true) return@GlassBottomBar
                        navController.navigate(tab.route) {
                            popUpTo(navController.graph.findStartDestination().id)
                            launchSingleTop = true
                        }
                    }
                )
            }
        }
    }
}

// CastBanner condiviso: vedi navigation/CastBanner.kt