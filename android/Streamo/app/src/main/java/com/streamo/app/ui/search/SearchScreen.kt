package com.streamo.app.ui.search

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items as LazyListItems
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.streamo.app.data.remote.dto.TmdbGenre
import com.streamo.app.data.remote.dto.TmdbItem
import com.streamo.app.tmdb.TMDBImage
import com.streamo.app.ui.common.GlassDefaults
import com.streamo.app.ui.common.GlassFilterChip
import com.streamo.app.ui.common.MediaCard
import com.streamo.app.ui.common.SkeletonCard

@Composable
fun SearchScreen(
    onNavigateToDetail: (Int, String, Int, Int) -> Unit = { _, _, _, _ -> },
    viewModel: SearchViewModel = hiltViewModel()
) {
    val gridState = rememberLazyGridState()
    val showCardInfo by viewModel.showCardInfo.collectAsState()

    LaunchedEffect(gridState, viewModel.query) {
        snapshotFlow { gridState.layoutInfo.visibleItemsInfo }
            .collect { visibleItems ->
                if (visibleItems.isNotEmpty() && viewModel.hasMore && !viewModel.isSearching) {
                    val lastVisible = visibleItems.last().index
                    val total = viewModel.results.size
                    if (lastVisible >= total - 6) {
                        viewModel.loadMore()
                    }
                }
            }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .padding(horizontal = 16.dp)
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            OutlinedTextField(
                value = viewModel.query,
                onValueChange = { viewModel.onQueryChange(it) },
                placeholder = { Text("Titolo, film o serie TV") },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                singleLine = true,
                shape = RoundedCornerShape(28.dp),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = GlassDefaults.Container,
                    unfocusedContainerColor = GlassDefaults.Container,
                    disabledContainerColor = GlassDefaults.Container,
                    focusedIndicatorColor = MaterialTheme.colorScheme.primary,
                    unfocusedIndicatorColor = GlassDefaults.Border
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp, bottom = 8.dp)
                    .onFocusChanged { viewModel.onFocusChange(it.isFocused) }
            )

            // Barra filtri sempre visibile
            FilterBar(
                mediaTypeFilter = viewModel.mediaTypeFilter,
                selectedGenreId = viewModel.selectedGenreId,
                availableGenres = viewModel.availableGenres,
                onMediaTypeChange = viewModel::onMediaTypeFilterChange,
                onGenreChange = viewModel::onGenreFilterChange
            )

            // Contenuto principale
            when {
                // Stato vuoto — nessuna ricerca, nessun filtro
                viewModel.results.isEmpty() && viewModel.query.trim().length < 2 && !viewModel.isSearching -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "Cosa vuoi guardare?\nCerca un titolo o seleziona un filtro per scoprire nuovi film e serie TV",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(32.dp)
                        )
                    }
                }

                // Caricamento iniziale
                viewModel.isSearching && viewModel.results.isEmpty() -> {
                    LazyVerticalGrid(
                        columns = GridCells.Adaptive(minSize = 140.dp),
                        contentPadding = PaddingValues(vertical = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                        verticalArrangement = Arrangement.spacedBy(18.dp)
                    ) {
                        items(9) {
                            SkeletonCard()
                        }
                    }
                }

                // Nessun risultato da search
                viewModel.results.isEmpty() && viewModel.query.trim().length >= 2 -> {
                    Text(
                        text = "Nessun risultato per \"${viewModel.query}\"",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 24.dp)
                    )
                }

                // Risultati (da search o browse)
                viewModel.results.isNotEmpty() -> {
                    LazyVerticalGrid(
                        state = gridState,
                        columns = GridCells.Adaptive(minSize = 140.dp),
                        contentPadding = PaddingValues(vertical = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                        verticalArrangement = Arrangement.spacedBy(18.dp)
                    ) {
                        items(viewModel.results) { item ->
                            val type = item.mediaType ?: "movie"
                            MediaCard(
                                title = item.displayTitle,
                                posterUrl = TMDBImage.url(item.posterPath, TMDBImage.Size.W500),
                                year = item.year,
                                rating = item.voteAverage,
                                showInfo = showCardInfo,
                                onClick = {
                                    viewModel.saveSearchQuery(viewModel.query)
                                    onNavigateToDetail(item.id, type, 0, 0)
                                }
                            )
                        }
                        if (viewModel.hasMore && viewModel.isSearching) {
                            item {
                                Box(
                                    modifier = Modifier.fillMaxWidth(),
                                    contentAlignment = Alignment.Center
                                ) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.padding(16.dp)
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }

        // Overlay cronologia sotto search box
        if (viewModel.isSearchFieldFocused && viewModel.query.trim().length < 2) {
            SearchHistoryDropdown(
                history = viewModel.searchHistory,
                onQueryClick = { viewModel.onQueryChange(it) },
                onDelete = { viewModel.deleteSearchQuery(it) },
                modifier = Modifier
                    .padding(top = 60.dp)
                    .fillMaxWidth()
            )
        }
    }
}

@Composable
private fun SearchHistoryDropdown(
    history: List<String>,
    onQueryClick: (String) -> Unit,
    onDelete: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .background(
                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.95f),
                RoundedCornerShape(14.dp)
            )
    ) {
        if (history.isEmpty()) {
            Text(
                text = "Nessuna ricerca recente",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(16.dp)
            )
        } else {
            Text(
                text = "Ricerche recenti",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 4.dp)
            )
            LazyColumn(modifier = Modifier.height(50.dp * minOf(history.size, 8))) {
                LazyListItems(history, key = { it }) { query ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onQueryClick(query) }
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.History,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(start = 4.dp)
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        Text(
                            text = query,
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurface,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f)
                        )
                        IconButton(onClick = { onDelete(query) }) {
                            Icon(
                                imageVector = Icons.Default.Close,
                                contentDescription = "Elimina ricerca",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FilterBar(
    mediaTypeFilter: String,
    selectedGenreId: Int?,
    availableGenres: List<TmdbGenre>,
    onMediaTypeChange: (String) -> Unit,
    onGenreChange: (Int?) -> Unit
) {
    Column(modifier = Modifier.padding(vertical = 4.dp)) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(bottom = 8.dp)
        ) {
            GlassFilterChip(
                label = "Tutti",
                selected = mediaTypeFilter == "all",
                onClick = { onMediaTypeChange("all") }
            )
            GlassFilterChip(
                label = "Film",
                selected = mediaTypeFilter == "movie",
                onClick = { onMediaTypeChange("movie") }
            )
            GlassFilterChip(
                label = "Serie TV",
                selected = mediaTypeFilter == "tv",
                onClick = { onMediaTypeChange("tv") }
            )
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            GlassFilterChip(
                label = "Tutti i generi",
                selected = selectedGenreId == null,
                onClick = { onGenreChange(null) }
            )
            availableGenres.forEach { genre ->
                GlassFilterChip(
                    label = genre.name,
                    selected = selectedGenreId == genre.id,
                    onClick = { onGenreChange(genre.id) }
                )
            }
        }
    }
}