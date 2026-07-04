package com.streamo.app.ui.tv

import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import com.streamo.app.navigation.LocalNavController
import com.streamo.app.navigation.NavRoutes
import com.streamo.app.ui.tv.detail.TvDetailScreen
import com.streamo.app.ui.tv.home.TvHomeScreen
import com.streamo.app.ui.tv.library.TvLibraryScreen
import com.streamo.app.ui.tv.player.TvPlayerScreen
import com.streamo.app.ui.tv.search.TvSearchScreen
import com.streamo.app.ui.tv.sectionlist.TvSectionListScreen
import com.streamo.app.ui.tv.settings.TvCacheManagementScreen
import com.streamo.app.ui.tv.settings.TvLogViewerScreen
import com.streamo.app.ui.tv.settings.TvSettingsScreen
import com.streamo.app.ui.tv.anime.TvAnimeScreen
import com.streamo.app.ui.tv.anime.TvAnimeDetailScreen

/**
 * TV navigation host. Mirrors [com.streamo.app.navigation.AppNavHost] but maps
 * routes to TV screens. Uses the same [NavRoutes] sealed class and [LocalNavController].
 * All transitions are None — D-pad nav should feel instant.
 */
@Composable
fun TvAppNavHost(
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
            exitTransition = { ExitTransition.None },
            popEnterTransition = { EnterTransition.None },
            popExitTransition = { ExitTransition.None }
        ) {
            composable<NavRoutes.Home> {
                TvHomeScreen(
                    onNavigateToDetail = { tmdbId, mediaType, season, episode ->
                        navController.navigate(NavRoutes.Detail(tmdbId, mediaType, season, episode))
                    },
                    onNavigateToSectionList = { title, endpoint, mediaType ->
                        navController.navigate(NavRoutes.SectionList(title, endpoint, mediaType))
                    },
                    onNavigateToContinueWatching = {
                        navController.navigate(NavRoutes.Library)
                    },
                    onNavigateToWatchlist = {
                        navController.navigate(NavRoutes.Library)
                    },
                    onNavigateToPlayer = { tmdbId, mediaType, season, episode, title, poster, releaseDate ->
                        navController.navigate(NavRoutes.Player(tmdbId, mediaType, season, episode, title, poster, releaseDate))
                    }
                )
            }
            composable<NavRoutes.Search> {
                TvSearchScreen(
                    onNavigateToDetail = { tmdbId, mediaType, season, episode ->
                        navController.navigate(NavRoutes.Detail(tmdbId, mediaType, season, episode))
                    }
                )
            }
            composable<NavRoutes.Library> {
                TvLibraryScreen(
                    onNavigateToDetail = { tmdbId, mediaType, season, episode ->
                        navController.navigate(NavRoutes.Detail(tmdbId, mediaType, season, episode))
                    },
                    onNavigateToPlayer = { tmdbId, mediaType, season, episode, title, poster, releaseDate ->
                        navController.navigate(NavRoutes.Player(tmdbId, mediaType, season, episode, title, poster, releaseDate))
                    }
                )
            }
            composable<NavRoutes.Anime> {
                TvAnimeScreen(
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
            composable<NavRoutes.AnimeDetail> {
                TvAnimeDetailScreen(
                    onBack = { navController.popBackStack() }
                )
            }
            composable<NavRoutes.Detail> {
                TvDetailScreen(
                    onBack = { navController.popBackStack() },
                    onNavigateToDetail = { tmdbId, mediaType, season, episode ->
                        navController.navigate(NavRoutes.Detail(tmdbId, mediaType, season, episode))
                    },
                    onNavigateToPlayer = { tmdbId, mediaType, season, episode, title, poster, releaseDate ->
                        navController.navigate(NavRoutes.Player(tmdbId, mediaType, season, episode, title, poster, releaseDate))
                    }
                )
            }
            composable<NavRoutes.SectionList> {
                TvSectionListScreen(
                    onNavigateToDetail = { tmdbId, mediaType, season, episode ->
                        navController.navigate(NavRoutes.Detail(tmdbId, mediaType, season, episode))
                    },
                    onBack = { navController.popBackStack() }
                )
            }
            composable<NavRoutes.Settings> {
                TvSettingsScreen(
                    onNavigateToDebugLogs = { navController.navigate(NavRoutes.DebugLogs) },
                    onNavigateToCacheManagement = { navController.navigate(NavRoutes.CacheManagement) }
                )
            }
            composable<NavRoutes.CacheManagement> {
                TvCacheManagementScreen(
                    onBack = { navController.popBackStack() }
                )
            }
            composable<NavRoutes.DebugLogs> {
                TvLogViewerScreen(
                    onBack = { navController.popBackStack() }
                )
            }
            composable<NavRoutes.Player> {
                TvPlayerScreen(
                    onBack = { navController.popBackStack() },
                    onNavigateToPlayer = { tmdbId, mediaType, season, episode, title, poster, releaseDate ->
                        navController.navigate(
                            NavRoutes.Player(tmdbId, mediaType, season, episode, title, poster, releaseDate)
                        )
                    }
                )
            }
        }
    }
}