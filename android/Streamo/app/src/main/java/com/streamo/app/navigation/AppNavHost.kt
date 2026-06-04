package com.streamo.app.navigation

import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import com.streamo.app.ui.continuewatching.ContinueWatchingScreen
import com.streamo.app.ui.detail.DetailScreen
import com.streamo.app.ui.downloads.DownloadsScreen
import com.streamo.app.ui.downloads.SeriesDownloadsScreen
import com.streamo.app.ui.history.HistoryScreen
import com.streamo.app.ui.home.HomeScreen
import com.streamo.app.ui.player.PlayerScreen
import com.streamo.app.ui.search.SearchScreen
import com.streamo.app.ui.sectionlist.SectionListScreen
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
        enterTransition = { EnterTransition.None },
        exitTransition = { ExitTransition.None }
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
                }
            )
        }
        composable<NavRoutes.Settings> {
            SettingsScreen()
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
                }
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
