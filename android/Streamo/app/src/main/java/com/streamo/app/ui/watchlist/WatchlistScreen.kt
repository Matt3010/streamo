package com.streamo.app.ui.watchlist

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.streamo.app.tmdb.TMDBImage
import com.streamo.app.ui.common.GlassFilterChip
import com.streamo.app.ui.common.ProgressMediaCard

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WatchlistScreen(
    onNavigateToDetail: (Int, String, Int, Int) -> Unit = { _, _, _, _ -> },
    viewModel: WatchlistViewModel = hiltViewModel()
) {
    val scrollBehavior = TopAppBarDefaults.enterAlwaysScrollBehavior()
    val items by viewModel.items.collectAsState()
    val selectedType by viewModel.selectedType.collectAsState()
    val selectedStatus by viewModel.selectedStatus.collectAsState()

    Scaffold(
        contentWindowInsets = androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0),
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        "La mia lista",
                        style = MaterialTheme.typography.titleLarge
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                    scrolledContainerColor = MaterialTheme.colorScheme.background,
                    titleContentColor = MaterialTheme.colorScheme.onBackground
                ),
                scrollBehavior = scrollBehavior
            )
        }
    ) { paddingValues ->
        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 140.dp),
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues),
            contentPadding = PaddingValues(16.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp)
        ) {
            // Filtro tipo.
            item(span = { GridItemSpan(maxLineSpan) }) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Chip("Tutti", selectedType == WatchlistType.ALL) { viewModel.setType(WatchlistType.ALL) }
                    Chip("TV", selectedType == WatchlistType.TV) { viewModel.setType(WatchlistType.TV) }
                    Chip("Film", selectedType == WatchlistType.MOVIE) { viewModel.setType(WatchlistType.MOVIE) }
                }
            }

            // Filtro stato.
            item(span = { GridItemSpan(maxLineSpan) }) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Chip("Tutti", selectedStatus == WatchlistStatusFilter.ALL) { viewModel.setStatus(WatchlistStatusFilter.ALL) }
                    Chip("Da guardare", selectedStatus == WatchlistStatusFilter.TODO) { viewModel.setStatus(WatchlistStatusFilter.TODO) }
                    Chip("In corso", selectedStatus == WatchlistStatusFilter.IN_PROGRESS) { viewModel.setStatus(WatchlistStatusFilter.IN_PROGRESS) }
                    Chip("Visto", selectedStatus == WatchlistStatusFilter.DONE) { viewModel.setStatus(WatchlistStatusFilter.DONE) }
                }
            }

            if (items.isEmpty()) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Text(
                        text = "Nessun titolo in questa categoria. Cambia filtro o aggiungi titoli dalla pagina dei dettagli.",
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(top = 40.dp, start = 8.dp, end = 8.dp),
                        textAlign = TextAlign.Center,
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else {
                items(items, key = { "${it.entry.mediaType}-${it.entry.tmdbId}" }) { item ->
                    val entry = item.entry
                    val p = item.progress
                    ProgressMediaCard(
                        title = entry.title,
                        posterUrl = entry.posterPath?.let { TMDBImage.url(it, TMDBImage.Size.W500) },
                        season = p?.season?.takeIf { entry.mediaType == "tv" && it > 0 },
                        episode = p?.episode?.takeIf { entry.mediaType == "tv" && it > 0 },
                        positionSeconds = p?.positionSeconds ?: 0.0,
                        durationSeconds = p?.durationSeconds ?: 0.0,
                        onClick = { onNavigateToDetail(entry.tmdbId, entry.mediaType, p?.season ?: 0, p?.episode ?: 0) },
                        onRemove = { viewModel.remove(entry.tmdbId) }
                    )
                }
            }
        }
    }
}

@Composable
private fun Chip(label: String, selected: Boolean, onClick: () -> Unit) {
    GlassFilterChip(label = label, selected = selected, onClick = onClick)
}
