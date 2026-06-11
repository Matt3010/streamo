package com.streamo.app.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import androidx.hilt.navigation.compose.hiltViewModel
import com.streamo.app.data.local.entity.ProgressEntry
import com.streamo.app.data.local.entity.WatchlistEntry
import com.streamo.app.data.remote.dto.TmdbItem
import com.streamo.app.navigation.LocalNavController
import com.streamo.app.navigation.NavRoutes
import com.streamo.app.tmdb.TMDBImage
import com.streamo.app.ui.common.MediaCard
import com.streamo.app.ui.common.SectionHeader
import com.streamo.app.ui.common.SkeletonCard
import com.streamo.app.util.Format

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onNavigateToDetail: (Int, String, Int, Int) -> Unit = { _, _, _, _ -> },
    viewModel: HomeViewModel = hiltViewModel()
) {
    val watchlist by viewModel.watchlist.collectAsState()
    val progress by viewModel.progress.collectAsState()
    val showCardInfo by viewModel.showCardInfo.collectAsState()
    val navController = LocalNavController.current
    var showRemoveDialog by remember { mutableStateOf(false) }
    var entryToRemove by remember { mutableStateOf<ProgressEntry?>(null) }
    val scrollBehavior = TopAppBarDefaults.enterAlwaysScrollBehavior()

    LaunchedEffect(Unit) {
        viewModel.loadIfNeeded()
    }

    Scaffold(
        contentWindowInsets = androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0),
        topBar = {
            TopAppBar(
                title = {},
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                    scrolledContainerColor = MaterialTheme.colorScheme.background,
                    titleContentColor = MaterialTheme.colorScheme.onBackground
                ),
                actions = {
                    IconButton(onClick = { navController.navigate(NavRoutes.Settings) }) {
                        Icon(Icons.Outlined.Settings, contentDescription = "Impostazioni")
                    }
                    IconButton(onClick = { navController.navigate(NavRoutes.History) }) {
                        Icon(Icons.Outlined.History, contentDescription = "Cronologia")
                    }
                    IconButton(onClick = { navController.navigate(NavRoutes.Downloads) }) {
                        Icon(Icons.Outlined.Download, contentDescription = "Download")
                    }
                },
                scrollBehavior = scrollBehavior
            )
        }
    ) { paddingValues ->
        PullToRefreshBox(
            isRefreshing = viewModel.isLoading,
            onRefresh = { viewModel.reload() },
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .nestedScroll(scrollBehavior.nestedScrollConnection),
                contentPadding = PaddingValues(bottom = 12.dp),
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
                    // Hero carousel (trending merge) — full-bleed in cima.
                    if (viewModel.heroItems.isNotEmpty()) {
                        item {
                            HomeHero(
                                items = viewModel.heroItems,
                                isInWatchlist = { item -> watchlist.any { it.tmdbId == item.id } },
                                onPlay = { item ->
                                    navController.navigate(
                                        NavRoutes.Player(
                                            tmdbId = item.id,
                                            mediaType = item.mediaType ?: "movie",
                                            title = item.displayTitle,
                                            poster = item.posterPath,
                                            releaseDate = item.primaryDate
                                        )
                                    )
                                },
                                onToggleWatchlist = { viewModel.toggleWatchlist(it) },
                                onOpen = { item ->
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

                    // Top 10
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

        if (showRemoveDialog && entryToRemove != null) {
            val entry = entryToRemove!!
            AlertDialog(
                onDismissRequest = {
                    showRemoveDialog = false
                    entryToRemove = null
                },
                title = { Text("Rimuovi") },
                text = {
                    Text(
                        "Rimuovere \"${entry.title.ifBlank { "${entry.tmdbId}" }}\" dalla lista?"
                    )
                },
                confirmButton = {
                    TextButton(
                        onClick = {
                            viewModel.removeProgress(entry.tmdbId)
                            showRemoveDialog = false
                            entryToRemove = null
                        }
                    ) {
                        Text("Rimuovi", color = MaterialTheme.colorScheme.error)
                    }
                },
                dismissButton = {
                    TextButton(
                        onClick = {
                            showRemoveDialog = false
                            entryToRemove = null
                        }
                    ) {
                        Text("Annulla", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            )
        }
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
        Button(onClick = onRetry) {
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
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionHeader(
            title = "Continua a guardare",
            icon = Icons.Filled.PlayCircle,
            onClick = onHeaderClick
        )
        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp)
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
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionHeader(
            title = "La mia lista",
            icon = Icons.Filled.Bookmark,
            onClick = onHeaderClick
        )
        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp)
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

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionHeader(
            title = section.title,
            icon = section.icon,
            onClick = onHeaderClick
        )
        LazyRow(
            state = rowState,
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp)
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
