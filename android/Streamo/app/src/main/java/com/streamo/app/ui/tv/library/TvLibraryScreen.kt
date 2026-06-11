package com.streamo.app.ui.tv.library

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.PlayCircle
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
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.streamo.app.tmdb.TMDBImage
import com.streamo.app.ui.common.AmbientBackground
import com.streamo.app.ui.continuewatching.ContinueWatchingViewModel
import com.streamo.app.ui.history.HistoryViewModel
import com.streamo.app.ui.tv.common.TvImmersiveRow
import com.streamo.app.ui.tv.common.TvProgressMediaCard
import com.streamo.app.ui.tv.common.TvMediaCard
import com.streamo.app.ui.watchlist.WatchlistViewModel

/**
 * TV Library screen — collapsed Watchlist + History + Continue Watching.
 * Three internal rows: Continua a guardare, La mia lista, Cronologia.
 * Initial focus lands on the first card of the first non-empty row.
 */
@Composable
fun TvLibraryScreen(
    onNavigateToDetail: (Int, String, Int, Int) -> Unit = { _, _, _, _ -> },
    onNavigateToPlayer: (Int, String, Int, Int, String, String?, String?) -> Unit = { _, _, _, _, _, _, _ -> },
    continueWatchingVm: ContinueWatchingViewModel = hiltViewModel(),
    watchlistVm: WatchlistViewModel = hiltViewModel(),
    historyVm: HistoryViewModel = hiltViewModel()
) {
    val continueWatching by continueWatchingVm.items.collectAsState()
    val watchlist by watchlistVm.items.collectAsState()
    val historyState by historyVm.state.collectAsState()

    val allHistoryItems = remember(historyState.sections) {
        historyState.sections.flatMap { it.items }
    }

    val firstCardFocus = remember { FocusRequester() }
    // Which row owns initial focus.
    val focusTarget = when {
        continueWatching.isNotEmpty() -> 0
        watchlist.isNotEmpty() -> 1
        allHistoryItems.isNotEmpty() -> 2
        else -> -1
    }

    LaunchedEffect(focusTarget) {
        if (focusTarget >= 0) runCatching { firstCardFocus.requestFocus() }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        AmbientBackground()

        if (focusTarget == -1) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    text = "La tua libreria è vuota.\nAggiungi titoli alla lista o inizia a guardare.",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            return@Box
        }

        LazyColumn(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp)
        ) {
            // Continue Watching
            if (continueWatching.isNotEmpty()) {
                item {
                    TvImmersiveRow(title = "Continua a guardare", icon = Icons.Filled.PlayCircle) {
                        items(continueWatching.size) { index ->
                            val entry = continueWatching[index]
                            TvProgressMediaCard(
                                title = entry.title.ifBlank { "${entry.tmdbId}" },
                                posterUrl = entry.posterPath?.let { TMDBImage.url(it, TMDBImage.Size.W500) },
                                season = entry.season.takeIf { entry.mediaType == "tv" && it > 0 },
                                episode = entry.episode.takeIf { entry.mediaType == "tv" && it > 0 },
                                positionSeconds = entry.positionSeconds,
                                durationSeconds = entry.durationSeconds,
                                focusRequester = if (focusTarget == 0 && index == 0) firstCardFocus else null,
                                onClick = {
                                    onNavigateToDetail(entry.tmdbId, entry.mediaType, entry.season, entry.episode)
                                }
                            )
                        }
                    }
                }
            }

            // Watchlist (La mia lista)
            if (watchlist.isNotEmpty()) {
                item {
                    TvImmersiveRow(title = "La mia lista", icon = Icons.Filled.Bookmark) {
                        items(watchlist.size) { index ->
                            val item = watchlist[index]
                            TvMediaCard(
                                title = item.entry.title,
                                posterUrl = item.entry.posterPath?.let { TMDBImage.url(it, TMDBImage.Size.W500) },
                                focusRequester = if (focusTarget == 1 && index == 0) firstCardFocus else null,
                                onClick = { onNavigateToDetail(item.entry.tmdbId, item.entry.mediaType, 0, 0) }
                            )
                        }
                    }
                }
            }

            // History (Cronologia)
            if (allHistoryItems.isNotEmpty()) {
                item {
                    TvImmersiveRow(title = "Cronologia", icon = Icons.Filled.History) {
                        items(allHistoryItems.size) { index ->
                            val historyItem = allHistoryItems[index]
                            val entry = historyItem.entry
                            TvProgressMediaCard(
                                title = entry.title.ifBlank { "${entry.tmdbId}" },
                                posterUrl = entry.posterPath?.let { TMDBImage.url(it, TMDBImage.Size.W500) },
                                season = entry.season.takeIf { entry.mediaType == "tv" && it > 0 },
                                episode = entry.episode.takeIf { entry.mediaType == "tv" && it > 0 },
                                statusText = historyItem.statusText,
                                focusRequester = if (focusTarget == 2 && index == 0) firstCardFocus else null,
                                onClick = {
                                    onNavigateToDetail(entry.tmdbId, entry.mediaType, entry.season, entry.episode)
                                }
                            )
                        }
                    }
                }
            }
        }
    }
}
