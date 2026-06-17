package com.streamo.app.navigation

import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.toRoute
import com.streamo.app.ui.continuewatching.ContinueWatchingScreen
import com.streamo.app.ui.detail.DetailScreen
import com.streamo.app.ui.downloads.DownloadsScreen
import com.streamo.app.ui.downloads.SeriesDownloadsScreen
import com.streamo.app.ui.history.HistoryScreen
import com.streamo.app.ui.home.HomeScreen
import com.streamo.app.ui.player.PlayerScreen
import com.streamo.app.ui.search.SearchScreen
import com.streamo.app.ui.sectionlist.SectionListScreen
import com.streamo.app.ui.settings.AdvancedSettingsScreen
import com.streamo.app.ui.settings.LogViewerScreen
import com.streamo.app.ui.settings.SettingsScreen
import com.streamo.app.ui.watchlist.WatchlistScreen

@Composable
fun AppNavHost(
    navController: NavHostController,
    startDestination: NavRoutes = NavRoutes.Home,
    modifier: Modifier = Modifier
) {
    CompositionLocalProvider(LocalNavController provides navController) {
    NavHost(
        navController = navController,
        startDestination = startDestination,
        modifier = modifier,
        // Cambio tab: il contenuto scorre verso sinistra/destra in base all'ordine
        // dei tab (Home 0 · Cerca 1 · Lista 2). Forward verso Detail/Player resta
        // istantaneo (None) — solo il pop anima, vedi più sotto.
        enterTransition = {
            val dir = tabDirection(initialState, targetState)
            if (dir != 0) {
                slideInHorizontally(tween(300)) { full -> dir * full } + fadeIn(tween(300))
            } else EnterTransition.None
        },
        exitTransition = {
            val dir = tabDirection(initialState, targetState)
            if (dir != 0) {
                slideOutHorizontally(tween(300)) { full -> -dir * full } + fadeOut(tween(300))
            } else ExitTransition.None
        },
        // Solo i pop animano: su Android 13+ la gesture "indietro" usa queste
        // transizioni in modo seekable e mostra l'anteprima della schermata
        // precedente. Su versioni più vecchie diventa una normale animazione di pop.
        // Tornare alla Home via tab è tecnicamente un pop (popUpTo Home): senza
        // questo check userebbe l'animazione "pagina sopra" del pop. Se la
        // transizione è tra due tab usa lo stesso slide simmetrico del cambio tab;
        // altrimenti (back da Detail/Player) resta l'animazione di pop classica.
        popEnterTransition = {
            val dir = tabDirection(initialState, targetState)
            if (dir != 0) slideInHorizontally(tween(300)) { full -> dir * full } + fadeIn(tween(300))
            else slideInHorizontally(animationSpec = tween(350)) { -it / 4 } + fadeIn(tween(350))
        },
        popExitTransition = {
            val dir = tabDirection(initialState, targetState)
            if (dir != 0) slideOutHorizontally(tween(300)) { full -> -dir * full } + fadeOut(tween(300))
            else slideOutHorizontally(animationSpec = tween(350)) { it } + fadeOut(tween(350))
        }
    ) {
        composable<NavRoutes.Home> {
            HomeScreen(
                onNavigateToDetail = { tmdbId, mediaType, season, episode ->
                    navController.navigate(
                        NavRoutes.Detail(tmdbId, mediaType, season, episode)
                    )
                }
            )
        }
        composable<NavRoutes.Search> {
            SearchScreen(
                onNavigateToDetail = { tmdbId, mediaType, season, episode ->
                    navController.navigate(
                        NavRoutes.Detail(tmdbId, mediaType, season, episode)
                    )
                }
            )
        }
        composable<NavRoutes.Watchlist> {
            WatchlistScreen(
                onNavigateToDetail = { tmdbId, mediaType, season, episode ->
                    navController.navigate(
                        NavRoutes.Detail(tmdbId, mediaType, season, episode)
                    )
                }
            )
        }
        composable<NavRoutes.Detail> {
            DetailScreen(
                onBack = { navController.popBackStack() }
            )
        }
        composable<NavRoutes.History> {
            HistoryScreen(
                onNavigateToDetail = { tmdbId, mediaType, season, episode ->
                    navController.navigate(
                        NavRoutes.Detail(tmdbId, mediaType, season, episode)
                    )
                },
                onBack = { navController.popBackStack() }
            )
        }
        composable<NavRoutes.Settings> {
            SettingsScreen(
                onNavigateToAdvanced = { navController.navigate(NavRoutes.AdvancedSettings()) },
                onNavigateToDebugLogs = { navController.navigate(NavRoutes.DebugLogs) },
                onBack = { navController.popBackStack() }
            )
        }
        composable<NavRoutes.DebugLogs> {
            LogViewerScreen(
                onBack = { navController.popBackStack() }
            )
        }
        composable<NavRoutes.AdvancedSettings> { backStackEntry ->
            val route: NavRoutes.AdvancedSettings = backStackEntry.toRoute()
            AdvancedSettingsScreen(
                scrollToWarp = route.scrollToWarp,
                onBack = { navController.popBackStack() }
            )
        }
        composable<NavRoutes.Downloads> {
            DownloadsScreen(
                onNavigateToDetail = { tmdbId, mediaType, season, episode ->
                    navController.navigate(
                        NavRoutes.Detail(tmdbId, mediaType, season, episode)
                    )
                },
                onNavigateToPlayer = { tmdbId, mediaType, season, episode, title, poster, releaseDate ->
                    navController.navigate(
                        NavRoutes.Player(tmdbId, mediaType, season, episode, title, poster, releaseDate)
                    )
                },
                onNavigateToSeriesDownloads = { tmdbId, title ->
                    navController.navigate(
                        NavRoutes.SeriesDownloads(tmdbId, title, showAllEpisodes = false)
                    )
                },
                onNavigateToAdvanced = { navController.navigate(NavRoutes.AdvancedSettings(scrollToWarp = true)) },
                onBack = { navController.popBackStack() }
            )
        }
        composable<NavRoutes.SeriesDownloads> {
            SeriesDownloadsScreen(
                onNavigateToDetail = { tmdbId, mediaType, season, episode ->
                    navController.navigate(
                        NavRoutes.Detail(tmdbId, mediaType, season, episode)
                    )
                },
                onNavigateToPlayer = { tmdbId, mediaType, season, episode, title, poster, releaseDate ->
                    navController.navigate(
                        NavRoutes.Player(tmdbId, mediaType, season, episode, title, poster, releaseDate)
                    )
                },
                onNavigateToAdvanced = { navController.navigate(NavRoutes.AdvancedSettings(scrollToWarp = true)) },
                onBack = { navController.popBackStack() }
            )
        }
        composable<NavRoutes.ContinueWatching> {
            ContinueWatchingScreen(
                onNavigateToDetail = { tmdbId, mediaType, season, episode ->
                    navController.navigate(
                        NavRoutes.Detail(tmdbId, mediaType, season, episode)
                    )
                },
                onNavigateToPlayer = { tmdbId, mediaType, season, episode, title, poster, releaseDate ->
                    navController.navigate(
                        NavRoutes.Player(tmdbId, mediaType, season, episode, title, poster, releaseDate)
                    )
                },
                onBack = { navController.popBackStack() }
            )
        }
        composable<NavRoutes.SectionList> {
            SectionListScreen(
                onNavigateToDetail = { tmdbId, mediaType, season, episode ->
                    navController.navigate(
                        NavRoutes.Detail(tmdbId, mediaType, season, episode)
                    )
                },
                onBack = { navController.popBackStack() }
            )
        }
        composable<NavRoutes.Player> {
            PlayerScreen(
                onBack = { navController.popBackStack() }
            )
        }
    }
    }
}

/** Ordine dei tab in basso; serve a decidere il verso dello slide al cambio tab. */
private val tabOrder = listOf(
    NavRoutes.Home::class,
    NavRoutes.Search::class,
    NavRoutes.Watchlist::class
)

private fun tabIndex(entry: NavBackStackEntry): Int =
    tabOrder.indexOfFirst { entry.destination.hasRoute(it) }

/**
 * +1 se si passa a un tab a indice maggiore (entra da destra), -1 se minore
 * (entra da sinistra), 0 se la transizione non è tra due tab (forward/back
 * verso Detail, Player, ecc.: nessuno slide direzionale).
 */
private fun tabDirection(from: NavBackStackEntry, to: NavBackStackEntry): Int {
    val a = tabIndex(from); val b = tabIndex(to)
    if (a < 0 || b < 0 || a == b) return 0
    return if (b > a) 1 else -1
}
