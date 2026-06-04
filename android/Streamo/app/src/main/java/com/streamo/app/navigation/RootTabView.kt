package com.streamo.app.navigation

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Cast
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.outlined.Bookmark
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.streamo.app.player.cast.CastBannerViewModel
import com.streamo.app.ui.common.AmbientBackground

private sealed class Tab(
    val route: NavRoutes,
    val title: String,
    val selectedIcon: ImageVector,
    val unselectedIcon: ImageVector
) {
    data object Home : Tab(NavRoutes.Home, "Home", Icons.Filled.Home, Icons.Outlined.Home)
    data object Search : Tab(NavRoutes.Search, "Cerca", Icons.Filled.Search, Icons.Outlined.Search)
    data object Watchlist : Tab(NavRoutes.Watchlist, "Lista", Icons.Filled.Bookmark, Icons.Outlined.Bookmark)
}

private val tabs = listOf(Tab.Home, Tab.Search, Tab.Watchlist)

@Composable
fun RootTabView() {
    val navController = rememberNavController()

    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = navBackStackEntry?.destination

    val bottomBarVisible = currentDestination?.hierarchy?.any {
        it.hasRoute(NavRoutes.Player::class)
    } != true

    Scaffold(
        contentWindowInsets = androidx.compose.foundation.layout.WindowInsets.navigationBars,
        bottomBar = {
            if (bottomBarVisible) {
                NavigationBar(
                    containerColor = MaterialTheme.colorScheme.surface,
                    contentColor = MaterialTheme.colorScheme.onBackground,
                    tonalElevation = 0.dp
                ) {
                    tabs.forEach { tab ->
                        val selected = currentDestination?.hierarchy?.any {
                            it.hasRoute(tab.route::class)
                        } == true
                        NavigationBarItem(
                            icon = {
                                Icon(
                                    imageVector = if (selected) tab.selectedIcon else tab.unselectedIcon,
                                    contentDescription = tab.title
                                )
                            },
                            label = { Text(tab.title) },
                            selected = selected,
                            onClick = {
                                navController.navigate(tab.route) {
                                    popUpTo(navController.graph.findStartDestination().id)
                                    launchSingleTop = true
                                }
                            },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = MaterialTheme.colorScheme.primary,
                                selectedTextColor = MaterialTheme.colorScheme.primary,
                                indicatorColor = MaterialTheme.colorScheme.primaryContainer,
                                unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                                unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        )
                    }
                }
            }
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            AmbientBackground()
            AppNavHost(
                navController = navController,
                modifier = Modifier.fillMaxSize()
            )

            // Banner trasmissione: visibile mentre si naviga l'app (non sul player),
            // se c'è un cast in corso. Cliccabile per tornare ai controlli.
            if (bottomBarVisible) {
                val castVm: CastBannerViewModel = hiltViewModel()
                val castSession by castVm.session.collectAsState()
                val castPlaying by castVm.isPlaying.collectAsState()
                castSession?.let { s ->
                    CastBanner(
                        title = s.media.displayTitle,
                        tvName = s.renderer.friendlyName,
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
                            .padding(12.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun CastBanner(
    title: String,
    tvName: String,
    isPlaying: Boolean,
    onClick: () -> Unit,
    onTogglePlay: () -> Unit,
    onStop: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = Color(0xFF1E1E20),
        shadowElevation = 6.dp
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
            IconButton(onClick = onStop) {
                Icon(
                    imageVector = Icons.Filled.Close,
                    contentDescription = "Interrompi",
                    tint = Color.White
                )
            }
        }
    }
}