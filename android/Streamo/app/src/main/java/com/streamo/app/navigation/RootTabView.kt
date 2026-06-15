package com.streamo.app.navigation

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
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
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.streamo.app.player.cast.CastBannerViewModel
import com.streamo.app.ui.common.AmbientBackground
import com.streamo.app.ui.common.GlassDefaults
import com.streamo.app.ui.common.LocalHazeState
import com.streamo.app.ui.common.LocalReducedEffects
import com.streamo.app.ui.common.glassCapsule
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.hazeSource

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
                    LocalHazeState provides hazeState
                ) {
                    AppNavHost(
                        navController = navController,
                        modifier = Modifier.fillMaxSize()
                    )
                }
            }

            // Banner trasmissione: visibile mentre si naviga l'app (non sul player),
            // se c'è un cast in corso. Cliccabile per tornare ai controlli.
            if (bottomBarVisible) {
                val castVm: CastBannerViewModel = hiltViewModel()
                val castSession by castVm.session.collectAsState()
                val castPlaying by castVm.isPlaying.collectAsState()
                castSession?.let { s ->
                    CastBanner(
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

            if (bottomBarVisible) {
                GlassBottomBar(
                    hazeState = hazeState,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .onSizeChanged { barHeightPx = it.height },
                    selectedRoute = { tab -> currentDestination?.hierarchy?.any { it.hasRoute(tab.route::class) } == true },
                    onSelect = { tab ->
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

/**
 * Bottom bar in stile "glass": pillola flottante semitrasparente con bordo
 * sottile (token [GlassDefaults]). Ogni tab è un bottone a capsula; quello
 * selezionato si tinge di primary ed espande la label, gli altri restano icona
 * muta. Galleggia sopra l'[AmbientBackground] da cui prende l'effetto vetro.
 */
@Composable
private fun GlassBottomBar(
    hazeState: HazeState,
    selectedRoute: (Tab) -> Boolean,
    onSelect: (Tab) -> Unit,
    modifier: Modifier = Modifier
) {
    val accent = MaterialTheme.colorScheme.primary
    val density = LocalDensity.current
    val selectedIndex = tabs.indexOfFirst(selectedRoute).coerceAtLeast(0)
    // Posizione/larghezza misurate di ogni tab (relative al wrapper) per far
    // scorrere un'unica pillola-highlight verso il tab selezionato.
    val tabOffsets = remember { mutableStateListOf(*Array(tabs.size) { 0.dp }) }
    val tabWidths = remember { mutableStateListOf(*Array(tabs.size) { 0.dp }) }
    var tabHeight by remember { mutableStateOf(0.dp) }
    // Modalità prestazioni: niente molla, la pillola salta diretta alla posizione.
    val reduced = LocalReducedEffects.current
    val pillSpec = if (reduced) snap() else spring<Dp>(dampingRatio = 0.8f, stiffness = 400f)
    val pillOffset by animateDpAsState(
        targetValue = tabOffsets[selectedIndex],
        animationSpec = pillSpec,
        label = "pillOffset"
    )
    val pillWidth by animateDpAsState(
        targetValue = tabWidths[selectedIndex],
        animationSpec = pillSpec,
        label = "pillWidth"
    )

    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(
                WindowInsets.navigationBars.asPaddingValues()
            )
            .padding(horizontal = 12.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center
    ) {
        Box(
            modifier = Modifier.glassCapsule(hazeState, GlassDefaults.ChipShape)
        ) {
            Box(modifier = Modifier.padding(horizontal = 6.dp, vertical = 6.dp)) {
                // Pillola scorrevole dietro i tab: trasla e si ridimensiona verso
                // il tab attivo (le label hanno larghezze diverse).
                if (pillWidth > 0.dp && tabHeight > 0.dp) {
                    Box(
                        modifier = Modifier
                            .offset(x = pillOffset)
                            .width(pillWidth)
                            .height(tabHeight)
                            .clip(GlassDefaults.ChipShape)
                            .background(accent.copy(alpha = 0.22f))
                    )
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    tabs.forEachIndexed { i, tab ->
                        val selected = selectedRoute(tab)
                        val contentColor by animateColorAsState(
                            targetValue = if (selected) accent else Color.White.copy(alpha = 0.6f),
                            label = "tabContent"
                        )
                        Column(
                            modifier = Modifier
                                .onGloballyPositioned { coords ->
                                    tabOffsets[i] = with(density) { coords.positionInParent().x.toDp() }
                                    tabWidths[i] = with(density) { coords.size.width.toDp() }
                                    tabHeight = with(density) { coords.size.height.toDp() }
                                }
                                .clip(GlassDefaults.ChipShape)
                                .clickable { onSelect(tab) }
                                .padding(horizontal = 24.dp, vertical = 6.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Icon(
                                imageVector = if (selected) tab.selectedIcon else tab.unselectedIcon,
                                contentDescription = tab.title,
                                tint = contentColor,
                                modifier = Modifier.size(20.dp)
                            )
                            Text(
                                text = tab.title,
                                color = contentColor,
                                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                                fontSize = 11.sp,
                                maxLines = 1
                            )
                        }
                    }
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