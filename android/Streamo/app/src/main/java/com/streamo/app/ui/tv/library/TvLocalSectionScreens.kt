package com.streamo.app.ui.tv.library

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.streamo.app.tmdb.TMDBImage
import com.streamo.app.ui.common.AmbientBackground
import com.streamo.app.ui.continuewatching.ContinueWatchingViewModel
import com.streamo.app.ui.tv.common.TvProgressMediaCard
import com.streamo.app.ui.watchlist.WatchlistViewModel
import kotlinx.coroutines.delay

@Composable
fun TvContinueWatchingScreen(
    onNavigateToDetail: (Int, String, Int, Int) -> Unit,
    onBack: () -> Unit,
    viewModel: ContinueWatchingViewModel = hiltViewModel()
) {
    val entries by viewModel.items.collectAsState()

    TvLocalSectionScreen(
        title = "Continua a guardare",
        emptyMessage = "Nessun elemento in corso.",
        items = entries.map { entry ->
            TvLocalItem(
                id = entry.tmdbId,
                mediaType = entry.mediaType,
                title = entry.title.ifBlank { "${entry.tmdbId}" },
                posterUrl = entry.posterPath?.let { TMDBImage.url(it, TMDBImage.Size.W500) },
                season = entry.season.takeIf { entry.mediaType == "tv" && it > 0 },
                episode = entry.episode.takeIf { entry.mediaType == "tv" && it > 0 },
                positionSeconds = entry.positionSeconds,
                durationSeconds = entry.durationSeconds
            )
        },
        onClick = { item ->
            onNavigateToDetail(item.id, item.mediaType, item.season ?: 0, item.episode ?: 0)
        },
        onBack = onBack
    )
}

@Composable
fun TvWatchlistScreen(
    onNavigateToDetail: (Int, String, Int, Int) -> Unit,
    onBack: () -> Unit,
    viewModel: WatchlistViewModel = hiltViewModel()
) {
    val entries by viewModel.items.collectAsState()

    TvLocalSectionScreen(
        title = "La mia lista",
        emptyMessage = "La tua lista è vuota.",
        items = entries.map { item ->
            val progress = item.progress
            TvLocalItem(
                id = item.entry.tmdbId,
                mediaType = item.entry.mediaType,
                title = item.entry.title,
                posterUrl = item.entry.posterPath?.let { TMDBImage.url(it, TMDBImage.Size.W500) },
                season = progress?.season?.takeIf { item.entry.mediaType == "tv" && it > 0 },
                episode = progress?.episode?.takeIf { item.entry.mediaType == "tv" && it > 0 },
                positionSeconds = progress?.positionSeconds ?: 0.0,
                durationSeconds = progress?.durationSeconds ?: 0.0
            )
        },
        onClick = { item ->
            onNavigateToDetail(item.id, item.mediaType, item.season ?: 0, item.episode ?: 0)
        },
        onBack = onBack
    )
}

private data class TvLocalItem(
    val id: Int,
    val mediaType: String,
    val title: String,
    val posterUrl: String?,
    val season: Int?,
    val episode: Int?,
    val positionSeconds: Double,
    val durationSeconds: Double
)

@Composable
private fun TvLocalSectionScreen(
    title: String,
    emptyMessage: String,
    items: List<TvLocalItem>,
    onClick: (TvLocalItem) -> Unit,
    onBack: () -> Unit
) {
    val firstCardFocus = remember { FocusRequester() }

    BackHandler { onBack() }
    LaunchedEffect(items.isNotEmpty()) {
        if (items.isNotEmpty()) repeat(30) {
            if (runCatching { firstCardFocus.requestFocus() }.getOrDefault(false)) {
                return@LaunchedEffect
            }
            delay(16)
        }
    }

    AmbientBackground()
    LazyVerticalGrid(
        columns = GridCells.Fixed(5),
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 32.dp, vertical = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Text(
                text = title,
                style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.onBackground,
                modifier = Modifier.padding(bottom = 8.dp)
            )
        }

        if (items.isEmpty()) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Text(
                    text = emptyMessage,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 32.dp)
                )
            }
        } else {
            // Chiave stabile per titolo: la lista Continua a guardare è ordinata per
            // updatedAt e può riordinarsi in ricomposizione — senza chiave il riordino
            // ricrea le card e fa perdere il focus.
            itemsIndexed(items, key = { _, item -> "${item.mediaType}:${item.id}" }) { index, item ->
                TvProgressMediaCard(
                    title = item.title,
                    posterUrl = item.posterUrl,
                    season = item.season,
                    episode = item.episode,
                    positionSeconds = item.positionSeconds,
                    durationSeconds = item.durationSeconds,
                    focusRequester = firstCardFocus.takeIf { index == 0 },
                    onClick = { onClick(item) }
                )
            }
        }
    }
}
