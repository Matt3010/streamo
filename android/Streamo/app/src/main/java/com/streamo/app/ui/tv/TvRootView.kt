package com.streamo.app.ui.tv

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.outlined.Bookmark
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.tv.material3.DrawerValue
import androidx.tv.material3.NavigationDrawer
import androidx.tv.material3.NavigationDrawerItem
import androidx.tv.material3.rememberDrawerState
import com.streamo.app.navigation.NavRoutes
import com.streamo.app.ui.common.AmbientBackground

private data class TvNavItem(
    val route: NavRoutes,
    val title: String,
    val selectedIcon: ImageVector,
    val unselectedIcon: ImageVector
)

private val tvNavItems = listOf(
    TvNavItem(NavRoutes.Home, "Home", Icons.Filled.Home, Icons.Outlined.Home),
    TvNavItem(NavRoutes.Search, "Cerca", Icons.Filled.Search, Icons.Outlined.Search),
    TvNavItem(NavRoutes.Library, "Libreria", Icons.Filled.Bookmark, Icons.Outlined.Bookmark),
    TvNavItem(NavRoutes.Settings, "Impostazioni", Icons.Filled.Settings, Icons.Outlined.Settings)
)

/**
 * TV root: persistent collapsible nav rail ([NavigationDrawer]) + [TvAppNavHost].
 * The rail collapses to icons and expands to labels on focus (canonical TV pattern).
 * It is hidden on the Player destination (immersive playback). No cast banner on TV.
 */
@Composable
fun TvRootView() {
    val navController = rememberNavController()
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = navBackStackEntry?.destination

    // Hide the rail on the Player (immersive playback).
    val showDrawer = currentDestination?.hierarchy?.any {
        it.hasRoute(NavRoutes.Player::class)
    } != true

    val selectedIndex = tvNavItems.indexOfFirst { item ->
        currentDestination?.hierarchy?.any { it.hasRoute(item.route::class) } == true
    }.takeIf { it >= 0 } ?: 0

    if (!showDrawer) {
        Box(modifier = Modifier.fillMaxSize()) {
            AmbientBackground()
            TvAppNavHost(navController = navController, modifier = Modifier.fillMaxSize())
        }
        return
    }

    NavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            Column(
                modifier = Modifier
                    .fillMaxHeight()
                    .padding(12.dp),
                horizontalAlignment = Alignment.Start,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                tvNavItems.forEachIndexed { index, item ->
                    val selected = selectedIndex == index
                    NavigationDrawerItem(
                        selected = selected,
                        onClick = {
                            navController.navigate(item.route) {
                                popUpTo(navController.graph.findStartDestination().id) {
                                    saveState = true
                                }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        leadingContent = {
                            Icon(
                                imageVector = if (selected) item.selectedIcon else item.unselectedIcon,
                                contentDescription = item.title
                            )
                        }
                    ) {
                        Text(item.title)
                    }
                }
            }
        }
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            AmbientBackground()
            TvAppNavHost(navController = navController, modifier = Modifier.fillMaxSize())
        }
    }
}
