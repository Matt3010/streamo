package com.streamo.app.ui.tv

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Animation
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.outlined.Animation
import androidx.compose.material.icons.outlined.Bookmark
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.foundation.focusGroup
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.tv.material3.DrawerValue
import androidx.tv.material3.NavigationDrawer
import androidx.tv.material3.NavigationDrawerItem
import androidx.tv.material3.rememberDrawerState
import com.streamo.app.navigation.NavRoutes
import kotlinx.coroutines.delay
import com.streamo.app.player.lancast.LanCastReceiver
import com.streamo.app.ui.common.AmbientBackground
import kotlinx.coroutines.launch

private data class TvNavItem(
    val route: NavRoutes,
    val title: String,
    val selectedIcon: ImageVector,
    val unselectedIcon: ImageVector
)

private val tvNavItems = listOf(
    TvNavItem(NavRoutes.Home, "Home", Icons.Filled.Home, Icons.Outlined.Home),
    TvNavItem(NavRoutes.Search, "Cerca", Icons.Filled.Search, Icons.Outlined.Search),
    TvNavItem(NavRoutes.Anime, "Anime", Icons.Filled.Animation, Icons.Outlined.Animation),
    TvNavItem(NavRoutes.Library, "Libreria", Icons.Filled.Bookmark, Icons.Outlined.Bookmark),
    TvNavItem(NavRoutes.Settings, "Impostazioni", Icons.Filled.Settings, Icons.Outlined.Settings)
)

/**
 * TV root: persistent collapsible nav rail ([NavigationDrawer]) + [TvAppNavHost].
 * The rail collapses to icons and expands to labels on focus (canonical TV pattern).
 * It is hidden on the Player destination (immersive playback). No cast banner on TV.
 *
 * No Haze/glass blur anywhere in `ui/tv/` (verified in the 2026-07 animation/style
 * audit, plans/ANIMATION_STYLE_AUDIT_PLAN.md §2.6): deliberate, not a missed port —
 * 10-foot UIs conventionally avoid heavy blur-behind chrome. TV uses flat surfaces
 * + focus rings instead (see TvSettingsScreen's dialog and TvFocusModifiers).
 */
@Composable
fun TvRootView() {
    val navController = rememberNavController()
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = navBackStackEntry?.destination
    val scope = rememberCoroutineScope()

    // Consumer globale dei comandi di cast Obsidian. Usa pendingPlay (StateFlow) invece del
    // flusso live così funziona anche a cold-start: il service porta l'app in primo piano,
    // qui leggiamo il Play in sospeso e apriamo il player. Se il player è già aperto, il
    // cambio contenuto lo gestisce TvPlayerScreen via il flusso commands. Transport idem.
    val castViewModel: TvCastViewModel = hiltViewModel()
    val pendingPlay by LanCastReceiver.pendingPlay.collectAsState()
    LaunchedEffect(pendingPlay) {
        val cmd = pendingPlay ?: return@LaunchedEffect
        LanCastReceiver.clearPendingPlay()
        val onPlayer = navController.currentDestination?.hierarchy?.any {
            it.hasRoute(NavRoutes.Player::class)
        } == true
        if (onPlayer) return@LaunchedEffect
        if (cmd.startPositionMs > 0) {
            castViewModel.saveExternalStartPosition(
                cmd.tmdbId, cmd.mediaType, cmd.season, cmd.episode, cmd.startPositionMs,
                cmd.title, cmd.posterUrl
            )
        }
        navController.navigate(
            NavRoutes.Player(
                cmd.tmdbId, cmd.mediaType, cmd.season, cmd.episode,
                cmd.title, cmd.posterUrl, cmd.releaseDate
            )
        )
    }

    // Hide the rail only on the Player (immersive playback).
    val showDrawer = currentDestination?.hierarchy?.any {
        it.hasRoute(NavRoutes.Player::class)
    } != true

    val selectedIndex = tvNavItems.indexOfFirst { item ->
        currentDestination?.hierarchy?.any { it.hasRoute(item.route::class) } == true
    }.takeIf { it >= 0 } ?: 0

    val contentFocusRequester = remember { FocusRequester() }

    // Close drawer on every back-stack entry change AND re-anchor focus into the content.
    // Keying on navBackStackEntry (not currentDestination) is required for Detail -> Detail
    // navigation because both entries share the same NavDestination instance.
    // contentFocusRequester sits on the content focusGroup (no focusable() on it: an extra
    // invisible focus target can win focus itself and trap it — verified regression).
    // requestFocus() on a group descends into its children (focusRestorer/default child) and
    // returns false while the new destination has no focusable child yet — retry a few frames.
    // Screens that manage their own initial focus (Home/Detail/SectionList) refine it after.
    LaunchedEffect(navBackStackEntry) {
        drawerState.setValue(DrawerValue.Closed)
        repeat(60) {
            if (runCatching { contentFocusRequester.requestFocus() }.getOrDefault(false)) {
                return@LaunchedEffect
            }
            delay(16)
        }
    }

    if (!showDrawer) {
        Box(modifier = Modifier.fillMaxSize()) {
            AmbientBackground()
            TvAppNavHost(navController = navController, modifier = Modifier.fillMaxSize())
        }
        return
    }

    // Padding/spacing del drawer diversi da GlassBottomBar (12dp/6dp) e dalla rail
    // tablet (8dp/4dp): non è drift da copia-incolla, sono tre componenti di
    // navigazione diversi (pillola flottante, rail Material, drawer TV a schermo
    // intero) — margini più larghi qui per il 10-foot UI. Rivisto in audit 2026-07
    // §2.6, valori confermati intenzionali.
    NavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            Column(
                modifier = Modifier
                    .fillMaxHeight()
                    // Il drawer si apre appena il suo subtree ha il focus. Quando la card
                    // focalizzata viene rimossa (cambio destinazione, riordino di una LazyRow)
                    // il framework riassegna il focus e può atterrare qui "da solo", aprendo
                    // la sidebar senza input. Consenti l'ingresso solo con D-pad sinistra:
                    // ogni altro ingresso viene annullato e la ricerca ricade sul contenuto.
                    .focusProperties {
                        onEnter = {
                            if (requestedFocusDirection != FocusDirection.Left) cancelFocusChange()
                        }
                    }
                    .padding(start = 16.dp, end = 16.dp, top = 32.dp, bottom = 16.dp),
                horizontalAlignment = Alignment.Start,
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                tvNavItems.forEachIndexed { index, item ->
                    val selected = selectedIndex == index
                    NavigationDrawerItem(
                        selected = selected,
                        onClick = {
                            scope.launch { drawerState.setValue(DrawerValue.Closed) }
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
        Box(
            modifier = Modifier
                .fillMaxSize()
                .focusRequester(contentFocusRequester)
                .focusRestorer()
                .focusGroup()
        ) {
            AmbientBackground()
            TvAppNavHost(navController = navController, modifier = Modifier.fillMaxSize())
        }
    }
}
