package com.streamo.app.ui.tv.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.streamo.app.data.local.entity.ProgressEntry
import com.streamo.app.data.local.entity.WatchlistEntry
import com.streamo.app.tmdb.TMDBImage
import com.streamo.app.ui.common.AmbientBackground
import com.streamo.app.ui.home.HomeSections
import com.streamo.app.ui.home.HomeViewModel
import com.streamo.app.ui.tv.common.TvImmersiveRow
import com.streamo.app.ui.tv.common.TvMediaCard
import com.streamo.app.ui.tv.common.TvProgressMediaCard
import com.streamo.app.ui.tv.common.TvSectionRow

/**
 * TV Home screen. Vertical list of immersive rows:
 * Continue Watching + My List (folded in) + catalog sections.
 * No PullToRefresh (D-pad); load in LaunchedEffect, retry via focusable button.
 * Initial focus lands on the first card of the first visible row.
 */
@Composable
fun TvHomeScreen(
    onNavigateToDetail: (Int, String, Int, Int) -> Unit = { _, _, _, _ -> },
    onNavigateToSectionList: (String, String, String) -> Unit = { _, _, _ -> },
    onNavigateToContinueWatching: () -> Unit = {},
    onNavigateToWatchlist: () -> Unit = {},
    onNavigateToPlayer: (Int, String, Int, Int, String, String?, String?) -> Unit = { _, _, _, _, _, _, _ -> },
    viewModel: HomeViewModel = hiltViewModel()
) {
    val watchlist by viewModel.watchlist.collectAsState()
    val progress by viewModel.progress.collectAsState()
    val firstCardFocus = remember { FocusRequester() }

    LaunchedEffect(Unit) { viewModel.loadIfNeeded() }

    // Drive initial focus onto the first card of whichever row renders first.
    val firstSectionId = HomeSections.all.firstOrNull()?.id
    val catalogReady = firstSectionId != null && viewModel.rows[firstSectionId]?.isNotEmpty() == true
    val focusTarget = when {
        progress.isNotEmpty() -> 0
        watchlist.isNotEmpty() -> 1
        catalogReady -> 2
        else -> -1
    }
    LaunchedEffect(focusTarget) {
        if (focusTarget >= 0) runCatching { firstCardFocus.requestFocus() }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        AmbientBackground()

        if (viewModel.errorMessage != null && viewModel.rows.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Text(
                        text = "Catalogo non disponibile",
                        style = MaterialTheme.typography.headlineSmall,
                        color = MaterialTheme.colorScheme.onBackground
                    )
                    Text(
                        text = viewModel.errorMessage!!,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 40.dp)
                    )
                    Button(onClick = { viewModel.reload() }) {
                        Text("Riprova")
                    }
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(24.dp)
            ) {
                if (progress.isNotEmpty()) {
                    item {
                        TvContinueWatchingRow(
                            entries = progress,
                            onNavigateToDetail = onNavigateToDetail,
                            onHeaderClick = onNavigateToContinueWatching,
                            firstCardFocusRequester = if (focusTarget == 0) firstCardFocus else null
                        )
                    }
                }

                if (watchlist.isNotEmpty()) {
                    item {
                        TvMyListRow(
                            entries = watchlist,
                            onNavigateToDetail = onNavigateToDetail,
                            onHeaderClick = onNavigateToWatchlist,
                            firstCardFocusRequester = if (focusTarget == 1) firstCardFocus else null
                        )
                    }
                }

                items(HomeSections.all) { section ->
                    TvSectionRow(
                        section = section,
                        items = viewModel.itemsFor(section),
                        loading = viewModel.isLoading,
                        onItemClick = { item ->
                            onNavigateToDetail(item.id, section.mediaType, 0, 0)
                        },
                        onHeaderClick = {
                            onNavigateToSectionList(section.title, section.endpoint, section.mediaType)
                        },
                        onLoadMore = { viewModel.loadMoreFor(section) },
                        firstCardFocusRequester = if (focusTarget == 2 && section.id == firstSectionId) firstCardFocus else null
                    )
                }
            }
        }
    }
}

@Composable
private fun TvContinueWatchingRow(
    entries: List<ProgressEntry>,
    onNavigateToDetail: (Int, String, Int, Int) -> Unit,
    onHeaderClick: () -> Unit,
    firstCardFocusRequester: FocusRequester?
) {
    TvImmersiveRow(title = "Continua a guardare", icon = Icons.Filled.PlayCircle, onHeaderClick = onHeaderClick) {
        items(entries.size) { index ->
            val entry = entries[index]
            TvProgressMediaCard(
                title = entry.title.ifBlank { "${entry.tmdbId} S${entry.season}:E${entry.episode}" },
                posterUrl = entry.posterPath?.let { TMDBImage.url(it, TMDBImage.Size.W500) },
                season = entry.season.takeIf { entry.mediaType == "tv" && it > 0 },
                episode = entry.episode.takeIf { entry.mediaType == "tv" && it > 0 },
                positionSeconds = entry.positionSeconds,
                durationSeconds = entry.durationSeconds,
                focusRequester = if (index == 0) firstCardFocusRequester else null,
                onClick = {
                    onNavigateToDetail(entry.tmdbId, entry.mediaType, entry.season, entry.episode)
                }
            )
        }
    }
}

@Composable
private fun TvMyListRow(
    entries: List<WatchlistEntry>,
    onNavigateToDetail: (Int, String, Int, Int) -> Unit,
    onHeaderClick: () -> Unit,
    firstCardFocusRequester: FocusRequester?
) {
    TvImmersiveRow(title = "La mia lista", icon = Icons.Filled.Bookmark, onHeaderClick = onHeaderClick) {
        items(entries.size) { index ->
            val entry = entries[index]
            TvMediaCard(
                title = entry.title,
                posterUrl = entry.posterPath?.let { TMDBImage.url(it, TMDBImage.Size.W500) },
                focusRequester = if (index == 0) firstCardFocusRequester else null,
                onClick = { onNavigateToDetail(entry.tmdbId, entry.mediaType, 0, 0) }
            )
        }
    }
}
