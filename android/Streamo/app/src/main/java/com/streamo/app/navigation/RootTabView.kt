package com.streamo.app.navigation

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cast
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
import com.streamo.app.ui.common.GlassAlertDialog
import com.streamo.app.ui.common.GlassDefaults
import com.streamo.app.ui.common.GlassDialogDestructiveButton
import com.streamo.app.ui.common.GlassDialogNeutralButton
import com.streamo.app.ui.common.LocalDialogHost
import com.streamo.app.ui.common.LocalHazeState
import com.streamo.app.ui.common.glassCapsule
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
 * Bottom bar in stile "glass": definita in `GlassBottomBar.kt` e condivisa
 * fra telefono ([RootTabView]) e tablet in portrait ([TabletRootView]).
 */
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