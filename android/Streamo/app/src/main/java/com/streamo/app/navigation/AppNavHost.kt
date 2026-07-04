package com.streamo.app.navigation

import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.toRoute
import com.streamo.app.ui.common.LocalReducedEffects
import com.streamo.app.ui.anime.AnimeDetailScreen
import com.streamo.app.ui.anime.AnimeScreen
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
import com.streamo.app.ui.settings.CacheManagementScreen
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
    // "Modalità prestazioni": disabilita ogni transizione di navigazione.
    val reduced = LocalReducedEffects.current
    NavHost(
        navController = navController,
        startDestination = startDestination,
        modifier = modifier,
        // Cambio tab: il contenuto scorre verso sinistra/destra in base all'ordine
        // dei tab (Home 0 · Cerca 1 · Anime 2 · Lista 3). Forward verso schermate
        // non-tab (Player, Impostazioni, Cronologia, Download, …) fade + slide-up;
        // Detail/AnimeDetail hanno la loro scale+fade (vedi sotto). Solo il pop
        // verso tab usa lo slide simmetrico; il pop da Detail/Player resta classico.
        // Con `reduced` tutto è None (navigazione istantanea).
        //
        // Tabella categorie di transizione (audit animazioni 2026-07, vedi
        // plans/ANIMATION_STYLE_AUDIT_PLAN.md §1.3): i valori sotto sono
        // deliberatamente diversi fra loro, non refusi da unificare.
        //   · Cambio tab (dir != 0): slide orizzontale + fade, 300ms, simmetrico
        //     push/pop — stesso "verso" percepito in entrambe le direzioni.
        //   · Push in avanti verso schermate non-tab (dir == 0, forward): fade +
        //     slide-up leggero, 260ms enter / 220ms exit — l'ingresso è
        //     leggermente più lento dell'uscita per dare peso all'apertura.
        //   · Pop verso schermate non-tab (dir == 0, indietro): slide orizzontale
        //     + fade, 350ms — più lento e con motion orizzontale (non verticale)
        //     per allinearsi al gesto "indietro" del sistema (swipe dal bordo).
        //   · Detail/AnimeDetail (vedi detailEnterTransition/detailExitTransition
        //     sotto): scale+fade 280ms enter / 220ms exit in push; 200ms fade
        //     piatto (nessuna scala) in pop, perché il pop mostra già l'anteprima
        //     della schermata precedente e non serve un effetto "apertura".
        enterTransition = {
            val dir = tabDirection(initialState, targetState)
            when {
                reduced -> EnterTransition.None
                dir != 0 -> slideInHorizontally(tween(300)) { full -> dir * full } + fadeIn(tween(300))
                else -> fadeIn(tween(260, easing = FastOutSlowInEasing)) +
                    slideInVertically(tween(260, easing = FastOutSlowInEasing)) { it / 10 }
            }
        },
        exitTransition = {
            val dir = tabDirection(initialState, targetState)
            when {
                reduced -> ExitTransition.None
                dir != 0 -> slideOutHorizontally(tween(300)) { full -> -dir * full } + fadeOut(tween(300))
                else -> fadeOut(tween(220))
            }
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
            when {
                reduced -> EnterTransition.None
                dir != 0 -> slideInHorizontally(tween(300)) { full -> dir * full } + fadeIn(tween(300))
                else -> slideInHorizontally(animationSpec = tween(350)) { -it / 4 } + fadeIn(tween(350))
            }
        },
        popExitTransition = {
            val dir = tabDirection(initialState, targetState)
            when {
                reduced -> ExitTransition.None
                dir != 0 -> slideOutHorizontally(tween(300)) { full -> -dir * full } + fadeOut(tween(300))
                else -> slideOutHorizontally(animationSpec = tween(350)) { it } + fadeOut(tween(350))
            }
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
        composable<NavRoutes.Anime> {
            AnimeScreen(
                onNavigateToDetail = { anime ->
                    navController.navigate(
                        NavRoutes.AnimeDetail(
                            animeId = anime.id,
                            slug = anime.slug,
                            title = anime.displayTitle,
                            poster = anime.imageurl,
                            type = anime.type,
                            year = anime.year ?: 0,
                            status = anime.status,
                            dub = anime.dub ?: 0,
                            plot = anime.plot
                        )
                    )
                }
            )
        }
        composable<NavRoutes.AnimeDetail>(
            enterTransition = { detailEnterTransition(reduced) },
            exitTransition = { detailExitTransition(reduced) },
            popEnterTransition = { if (reduced) EnterTransition.None else fadeIn(tween(200)) },
            popExitTransition = { if (reduced) ExitTransition.None else fadeOut(tween(200)) }
        ) {
            AnimeDetailScreen(onBack = { navController.popBackStack() })
        }
        composable<NavRoutes.Detail>(
            enterTransition = { detailEnterTransition(reduced) },
            exitTransition = { detailExitTransition(reduced) },
            popEnterTransition = { if (reduced) EnterTransition.None else fadeIn(tween(200)) },
            popExitTransition = { if (reduced) ExitTransition.None else fadeOut(tween(200)) }
        ) {
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
                onNavigateToCacheManagement = { navController.navigate(NavRoutes.CacheManagement) },
                onNavigateToDebugLogs = { navController.navigate(NavRoutes.DebugLogs) },
                onBack = { navController.popBackStack() }
            )
        }
        composable<NavRoutes.CacheManagement> {
            CacheManagementScreen(
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
    NavRoutes.Anime::class,
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

private fun isDetailRoute(entry: NavBackStackEntry): Boolean =
    entry.destination.hasRoute(NavRoutes.Detail::class)

/** Scale + Fade transition for Detail screen. `reduced` → None (modalità prestazioni). */
private fun detailEnterTransition(reduced: Boolean): EnterTransition {
    if (reduced) return EnterTransition.None
    return scaleIn(
        animationSpec = tween(durationMillis = 280, easing = FastOutSlowInEasing),
        initialScale = 0.92f
    ) + fadeIn(
        animationSpec = tween(durationMillis = 280, easing = FastOutSlowInEasing),
        initialAlpha = 0.3f
    )
}

private fun detailExitTransition(reduced: Boolean): ExitTransition {
    if (reduced) return ExitTransition.None
    return scaleOut(
        animationSpec = tween(durationMillis = 220, easing = FastOutSlowInEasing),
        targetScale = 0.95f
    ) + fadeOut(
        animationSpec = tween(durationMillis = 220, easing = FastOutSlowInEasing),
        targetAlpha = 0f
    )
}
