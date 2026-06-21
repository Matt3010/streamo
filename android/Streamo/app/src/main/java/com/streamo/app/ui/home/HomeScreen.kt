package com.streamo.app.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.BaselineShift
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import androidx.hilt.navigation.compose.hiltViewModel
import com.streamo.app.data.local.entity.ProgressEntry
import com.streamo.app.data.local.entity.WatchlistEntry
import com.streamo.app.data.remote.dto.TmdbItem
import com.streamo.app.navigation.LocalBottomBarPadding
import com.streamo.app.navigation.LocalNavController
import com.streamo.app.navigation.NavRoutes
import com.streamo.app.tmdb.TMDBImage
import com.streamo.app.ui.common.GlassAlertDialog
import com.streamo.app.ui.common.GlassDialogDestructiveButton
import com.streamo.app.ui.common.GlassDialogNeutralButton
import com.streamo.app.ui.common.GlassTopBarScaffold
import com.streamo.app.ui.common.LocalHazeState
import com.streamo.app.ui.common.BrandButton
import com.streamo.app.ui.common.MediaCard
import com.streamo.app.ui.common.SectionHeader
import com.streamo.app.ui.common.SkeletonCard
import com.streamo.app.ui.common.LocalWindowSizeClass
import com.streamo.app.ui.common.cardWidth
import com.streamo.app.ui.common.contentPadding
import com.streamo.app.ui.common.itemSpacing
import com.streamo.app.util.Format

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onNavigateToDetail: (Int, String, Int, Int) -> Unit = { _, _, _, _ -> },
    viewModel: HomeViewModel = hiltViewModel()
) {
    val windowSizeClass = LocalWindowSizeClass.current
    val watchlist by viewModel.watchlist.collectAsState()
    val progress by viewModel.progress.collectAsState()
    val showCardInfo by viewModel.showCardInfo.collectAsState()
    val navController = LocalNavController.current
    var showRemoveDialog by remember { mutableStateOf(false) }
    var entryToRemove by remember { mutableStateOf<ProgressEntry?>(null) }

    LaunchedEffect(Unit) {
        viewModel.loadIfNeeded()
    }

    GlassTopBarScaffold(
        onLeading = null,
        actions = {
            AnimatedActionIcon(
                icon = Icons.Outlined.Settings,
                contentDescription = "Impostazioni",
                onClick = { navController.navigate(NavRoutes.Settings) }
            )
            AnimatedActionIcon(
                icon = Icons.Outlined.History,
                contentDescription = "Cronologia",
                onClick = { navController.navigate(NavRoutes.History) }
            )
            AnimatedActionIcon(
                icon = Icons.Outlined.Download,
                contentDescription = "Download",
                onClick = { navController.navigate(NavRoutes.Downloads) },
                badgeCount = viewModel.activeDownloads.collectAsState().value.size,
                activePercent = viewModel.activeDownloadsPercent.collectAsState().value,
                failedCount = viewModel.failedDownloadsCount.collectAsState().value
            )
        }
    ) { topPadding ->
        PullToRefreshBox(
            isRefreshing = viewModel.isLoading,
            onRefresh = { viewModel.reload() },
            modifier = Modifier
                .fillMaxSize()
        ) {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize(),
                // topPadding saltato: l'hero copre full-bleed partendo da y=0.
                // La sua altezza naturale (450-560dp) spinge il resto sotto la
                // barra flottante; il padding lo gestisce il primo elemento.
                contentPadding = PaddingValues(bottom = 12.dp + LocalBottomBarPadding.current),
                verticalArrangement = Arrangement.spacedBy(24.dp)
            ) {
                if (viewModel.errorMessage != null && viewModel.rows.isEmpty()) {
                    item {
                        ErrorState(
                            message = viewModel.errorMessage!!,
                            onRetry = { viewModel.reload() }
                        )
                    }
                } else {
                    // Hero carousel (trending merge) — full-bleed, parte da y=0
                    // dietro la GlassTopBar. Se non c'è hero, uno spacer impedisce
                    // al primo contenuto di finire sotto la barra.
                    if (viewModel.heroItems.isNotEmpty()) {
                        item {
                            HomeHero(
                                items = viewModel.heroItems,
                                isInWatchlist = { item -> watchlist.any { it.tmdbId == item.id } },
                                onPlay = { item ->
                                    val mediaType = item.mediaType ?: "movie"
                                    if (mediaType == "tv") {
                                        // Serie → Detail cosí utente sceglie stagione/episodio
                                        onNavigateToDetail(item.id, mediaType, 0, 0)
                                    } else {
                                        // Film → Player diretto
                                        navController.navigate(
                                            NavRoutes.Player(
                                                tmdbId = item.id,
                                                mediaType = mediaType,
                                                title = item.displayTitle,
                                                poster = item.posterPath,
                                                releaseDate = item.primaryDate
                                            )
                                        )
                                    }
                                },
                                onToggleWatchlist = { viewModel.toggleWatchlist(it) },
                                onOpen = { item ->
                                    onNavigateToDetail(item.id, item.mediaType ?: "movie", 0, 0)
                                }
                            )
                        }
                    } else {
                        item { Spacer(modifier = Modifier.height(topPadding)) }
                    }

                    // Top 10 oggi — subito dopo l'hero
                    if (viewModel.top10.isNotEmpty()) {
                        item {
                            Top10Row(
                                items = viewModel.top10,
                                showInfo = showCardInfo,
                                onItemClick = { item ->
                                    onNavigateToDetail(item.id, item.mediaType ?: "movie", 0, 0)
                                }
                            )
                        }
                    }

                    // Continue watching
                    if (progress.isNotEmpty()) {
                        item {
                            ContinueWatchingRow(
                                entries = progress,
                                onNavigateToDetail = onNavigateToDetail,
                                onHeaderClick = { navController.navigate(NavRoutes.ContinueWatching) },
                                onRemove = { entry ->
                                    entryToRemove = entry
                                    showRemoveDialog = true
                                }
                            )
                        }
                    }

                    // My list
                    if (watchlist.isNotEmpty()) {
                        item {
                            MyListRow(
                                entries = watchlist,
                                showInfo = showCardInfo,
                                onNavigateToDetail = onNavigateToDetail,
                                onHeaderClick = { navController.navigate(NavRoutes.Watchlist) }
                            )
                        }
                    }

                    // Sections
                    items(HomeSections.all.filter { !it.hiddenFromRows }) { section ->
                        SectionRow(
                            section = section,
                            items = viewModel.itemsFor(section),
                            loading = viewModel.isLoading,
                            showInfo = showCardInfo,
                            onItemClick = { item ->
                                onNavigateToDetail(item.id, section.mediaType, 0, 0)
                            },
                            onHeaderClick = {
                                navController.navigate(
                                    NavRoutes.SectionList(
                                        title = section.title,
                                        endpoint = section.endpoint,
                                        mediaType = section.mediaType
                                    )
                                )
                            },
                            onLoadMore = { viewModel.loadMoreFor(section) }
                        )
                    }
                }
            }
        }

        }

    if (showRemoveDialog && entryToRemove != null) {
        val entry = entryToRemove!!
        GlassAlertDialog(
            onDismissRequest = {
                showRemoveDialog = false
                entryToRemove = null
            },
            hazeState = LocalHazeState.current,
            title = "Rimuovi",
            text = {
                Text(
                    "Rimuovere \"${entry.title.ifBlank { "${entry.tmdbId}" }}\" dalla lista?"
                )
            },
            confirmButton = {
                GlassDialogDestructiveButton(
                    onClick = {
                        viewModel.removeProgress(entry.tmdbId)
                        showRemoveDialog = false
                        entryToRemove = null
                    }
                ) {
                    Text("Rimuovi")
                }
            },
            dismissButton = {
                GlassDialogNeutralButton(
                    onClick = {
                        showRemoveDialog = false
                        entryToRemove = null
                    }
                ) {
                    Text("Annulla")
                }
            }
        )
    }
}

@Composable
private fun ErrorState(
    message: String,
    onRetry: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 60.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(
            text = "Catalogo non disponibile",
            style = MaterialTheme.typography.headlineSmall,
            color = MaterialTheme.colorScheme.onBackground
        )
        Text(
            text = message,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 40.dp)
        )
        BrandButton(onClick = onRetry) {
            Text("Riprova")
        }
    }
}

@Composable
private fun ContinueWatchingRow(
    entries: List<ProgressEntry>,
    onNavigateToDetail: (Int, String, Int, Int) -> Unit,
    onHeaderClick: () -> Unit,
    onRemove: (ProgressEntry) -> Unit = {}
) {
    val navController = LocalNavController.current
    val windowSizeClass = LocalWindowSizeClass.current
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionHeader(
            title = "Continua a guardare",
            icon = Icons.Filled.PlayCircle,
            onClick = onHeaderClick
        )
        LazyRow(
            contentPadding = PaddingValues(horizontal = windowSizeClass.contentPadding),
            horizontalArrangement = Arrangement.spacedBy(windowSizeClass.itemSpacing)
        ) {
            items(entries) { entry ->
                com.streamo.app.ui.common.ProgressMediaCard(
                    title = entry.title.ifBlank { "${entry.tmdbId} S${entry.season}:E${entry.episode}" },
                    posterUrl = entry.posterPath?.let { TMDBImage.url(it, TMDBImage.Size.W500) },
                    season = entry.season.takeIf { entry.mediaType == "tv" && it > 0 },
                    episode = entry.episode.takeIf { entry.mediaType == "tv" && it > 0 },
                    positionSeconds = entry.positionSeconds,
                    durationSeconds = entry.durationSeconds,
                    showPlayButton = true,
                    onClick = { onNavigateToDetail(entry.tmdbId, entry.mediaType, entry.season, entry.episode) },
                    onPlay = {
                        navController.navigate(
                            NavRoutes.Player(
                                tmdbId = entry.tmdbId,
                                mediaType = entry.mediaType,
                                resumeSeason = entry.season,
                                resumeEpisode = entry.episode,
                                title = entry.title.ifBlank { "${entry.tmdbId} S${entry.season}:E${entry.episode}" },
                                poster = entry.posterPath,
                                releaseDate = null
                            )
                        )
                    },
                    onRemove = { onRemove(entry) }
                )
            }
        }
    }
}

@Composable
private fun MyListRow(
    entries: List<WatchlistEntry>,
    showInfo: Boolean,
    onNavigateToDetail: (Int, String, Int, Int) -> Unit,
    onHeaderClick: () -> Unit
) {
    val windowSizeClass = LocalWindowSizeClass.current
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionHeader(
            title = "La mia lista",
            icon = Icons.Filled.Bookmark,
            onClick = onHeaderClick
        )
        LazyRow(
            contentPadding = PaddingValues(horizontal = windowSizeClass.contentPadding),
            horizontalArrangement = Arrangement.spacedBy(windowSizeClass.itemSpacing)
        ) {
            items(entries) { entry ->
                MediaCard(
                    title = entry.title,
                    posterUrl = entry.posterPath?.let { TMDBImage.url(it, TMDBImage.Size.W500) },
                    showInfo = showInfo,
                    onClick = { onNavigateToDetail(entry.tmdbId, entry.mediaType, 0, 0) }
                )
            }
        }
    }
}

@Composable
private fun SectionRow(
    section: HomeSection,
    items: List<TmdbItem>,
    loading: Boolean,
    showInfo: Boolean,
    onItemClick: (TmdbItem) -> Unit,
    onHeaderClick: () -> Unit,
    onLoadMore: () -> Unit
) {
    if (items.isEmpty() && !loading) return

    val rowState = androidx.compose.foundation.lazy.rememberLazyListState()

    androidx.compose.runtime.LaunchedEffect(rowState, items.size) {
        androidx.compose.runtime.snapshotFlow { rowState.layoutInfo.visibleItemsInfo }
            .collect { visibleItems ->
                if (visibleItems.isNotEmpty() && items.isNotEmpty()) {
                    val lastVisible = visibleItems.last().index
                    if (lastVisible >= items.size - 3) {
                        onLoadMore()
                    }
                }
            }
    }

    val windowSizeClass = LocalWindowSizeClass.current
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionHeader(
            title = section.title,
            icon = section.icon,
            onClick = onHeaderClick
        )
        LazyRow(
            state = rowState,
            contentPadding = PaddingValues(horizontal = windowSizeClass.contentPadding),
            horizontalArrangement = Arrangement.spacedBy(windowSizeClass.itemSpacing)
        ) {
            if (items.isEmpty()) {
                items(6) {
                    SkeletonCard()
                }
            } else {
                items(items) { item ->
                    MediaCard(
                        title = item.displayTitle,
                        posterUrl = TMDBImage.url(item.posterPath, TMDBImage.Size.W500),
                        year = item.year,
                        rating = item.voteAverage,
                        showInfo = showInfo,
                        onClick = { onItemClick(item) }
                    )
                }
            }
        }
    }
}

// ── Glass action icon with scale-on-press spring ──

@Composable
private fun AnimatedActionIcon(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    /** Count numerico in capsule rossa top-end (null/0 = niente badge). */
    badgeCount: Int = 0,
    /** Percentuale media 0..100 mostrata a destra dell'icona (-1 = niente). */
    activePercent: Int = -1,
    /** Count failed → warning triangolo sopra l'icona. */
    failedCount: Int = 0
) {
    val interactionSource = remember { MutableInteractionSource() }
    val isPressed by interactionSource.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (isPressed) 0.82f else 1f,
        animationSpec = spring(dampingRatio = 0.4f, stiffness = 300f)
    )

    // Box esterno: ospita icona (+ eventuale % a destra) e, in overlay assoluto,
    // il badge count. Padding laterale sul click target, non sul Box interno, così
    // il badge non viene clippato dal bordo.
    Box(
        modifier = Modifier
            .graphicsLayer(scaleX = scale, scaleY = scale)
            .clickable(interactionSource = interactionSource, indication = null) { onClick() }
            .padding(horizontal = 8.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            // Box wrapper sull'icona: serve come anchor per i badge (count +
            // warning), che devono stare sopra la SOLA icona, non sull'intera
            // capsula. Box 24dp = icona; i badge 12-16dp ci stanno dentro.
            Box(modifier = Modifier.size(24.dp)) {
                Icon(
                    imageVector = icon,
                    contentDescription = contentDescription,
                    tint = Color.White,
                    modifier = Modifier.fillMaxSize()
                )
                if (badgeCount > 0) {
                    Box(
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .offset(x = 4.dp, y = (-8).dp)
                            .size(14.dp)
                            .background(
                                color = Color(0xFFFF3B30),
                                shape = CircleShape
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = when {
                                badgeCount > 99 -> "99+"
                                badgeCount > 9 -> "9+"
                                else -> "$badgeCount"
                            },
                            color = Color.White,
                            fontSize = 8.sp,
                            fontWeight = FontWeight.Bold,
                            textAlign = TextAlign.Center,
                            style = TextStyle(
                                baselineShift = BaselineShift(-0.15f)
                            )
                        )
                    }
                }
                if (failedCount > 0) {
                    Box(
                        modifier = Modifier
                            .align(Alignment.BottomEnd)
                            .background(
                                color = Color.Black.copy(alpha = 0.55f),
                                shape = CircleShape
                            )
                            .padding(1.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Filled.Warning,
                            contentDescription = "$failedCount download falliti",
                            tint = Color(0xFFFF9500),
                            modifier = Modifier.size(10.dp)
                        )
                    }
                }
            }
            if (activePercent >= 0) {
                Text(
                    text = "$activePercent%",
                    color = Color.White.copy(alpha = 0.9f),
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium
                )
            }
        }
    }
}
