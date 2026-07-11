package com.streamo.app.ui.tv.search

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.hilt.navigation.compose.hiltViewModel
import com.streamo.app.data.remote.dto.TmdbGenre
import com.streamo.app.tmdb.TMDBImage
import com.streamo.app.ui.common.AmbientBackground
import com.streamo.app.ui.search.SearchViewModel
import com.streamo.app.ui.search.SortField
import com.streamo.app.ui.search.SortOrder
import com.streamo.app.ui.tv.common.TvFocusable
import com.streamo.app.ui.tv.common.TvMediaCard
import com.streamo.app.ui.tv.common.tvFocusRing
import kotlinx.coroutines.delay

/**
 * TV Search screen. OutlinedTextField (focus → system/leanback IME opens
 * automatically on TV/Fire TV) + filter bar + focusable grid of results.
 */
@Composable
fun TvSearchScreen(
    onNavigateToDetail: (Int, String, Int, Int) -> Unit = { _, _, _, _ -> },
    viewModel: SearchViewModel = hiltViewModel()
) {
    val searchFieldFocusRequester = remember { FocusRequester() }
    val gridState = rememberLazyGridState()
    var showGenrePicker by remember { mutableStateOf(false) }
    var showSortPicker by remember { mutableStateOf(false) }

    // Solo all'ingresso: keyare su mediaTypeFilter rirubava il focus alla
    // searchbar a ogni cambio filtro (Tutti/Film/Serie TV).
    LaunchedEffect(Unit) {
        repeat(60) {
            if (runCatching { searchFieldFocusRequester.requestFocus() }.getOrDefault(false)) {
                return@LaunchedEffect
            }
            delay(16)
        }
    }

    // La ricerca svuota i risultati prima della risposta: mantieni il focus sul
    // campo, che resta montato, altrimenti il focus ricade sulla sidebar.
    LaunchedEffect(viewModel.isSearching, viewModel.results.isEmpty()) {
        if (viewModel.isSearching && viewModel.results.isEmpty()) {
            while (viewModel.isSearching && viewModel.results.isEmpty()) {
                runCatching { searchFieldFocusRequester.requestFocus() }
                delay(80)
            }
        }
    }

    // Quando i risultati arrivano, il precedente target può essere stato rimosso:
    // riporta il focus sul campo di ricerca, che resta sempre montato.
    LaunchedEffect(viewModel.isSearching) {
        if (!viewModel.isSearching && viewModel.query.trim().length >= 2) repeat(60) {
            if (runCatching { searchFieldFocusRequester.requestFocus() }.getOrDefault(false)) {
                return@LaunchedEffect
            }
            delay(16)
        }
    }

    // Paging: load more results when within ~10 of the end.
    LaunchedEffect(gridState, viewModel.results.size) {
        snapshotFlow { gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }
            .collect { lastVisible ->
                val count = viewModel.results.size
                if (count > 0 && !viewModel.isSearching && lastVisible >= count - 10) {
                    viewModel.loadMore()
                }
            }
    }

    AmbientBackground()

    Column(modifier = Modifier.fillMaxSize().padding(horizontal = 48.dp, vertical = 24.dp)) {
        OutlinedTextField(
            value = viewModel.query,
            onValueChange = { viewModel.onQueryChange(it) },
            label = { Text("Cerca film o serie TV") },
            modifier = Modifier
                .fillMaxWidth()
                .focusRequester(searchFieldFocusRequester),
            singleLine = true
        )

        Spacer(modifier = Modifier.height(16.dp))

        TvFilterBar(
            mediaTypeFilter = viewModel.mediaTypeFilter,
            selectedGenreIds = viewModel.selectedGenreIds,
            selectedGenreNames = viewModel.selectedGenreNames,
            availableGenres = viewModel.availableGenres,
            sortField = viewModel.sortField,
            sortOrder = viewModel.sortOrder,
            onMediaTypeChange = viewModel::onMediaTypeFilterChange,
            onToggleGenre = viewModel::toggleGenre,
            onClearGenres = viewModel::clearGenreFilters,
            onOpenGenrePicker = { showGenrePicker = true },
            onOpenSortPicker = { showSortPicker = true }
        )

        if (viewModel.results.isEmpty() && !viewModel.isSearching && viewModel.query.isBlank()) {
            // Search history
            if (viewModel.searchHistory.isNotEmpty()) {
                Text(
                    text = "Ricerche recenti",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onBackground
                )
                Spacer(modifier = Modifier.height(8.dp))
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    items(viewModel.searchHistory.toList()) { historyQuery ->
                        TvFocusable(
                            onClick = {
                                // La voce cliccata sparisce appena cambia la query:
                                // assegna prima il focus al campo, così non ricade sulla sidebar.
                                searchFieldFocusRequester.requestFocus()
                                viewModel.onQueryChange(historyQuery)
                            },
                            modifier = Modifier.fillMaxWidth()
                        ) { focused ->
                            Text(
                                text = historyQuery,
                                style = MaterialTheme.typography.bodyLarge,
                                color = if (focused) Color.White else MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(if (focused) Color.White.copy(alpha = 0.12f) else Color.Transparent)
                                    .padding(horizontal = 12.dp, vertical = 10.dp)
                            )
                        }
                    }
                }
            }
        } else {
            LazyVerticalGrid(
                columns = GridCells.Fixed(5),
                state = gridState,
                contentPadding = PaddingValues(vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                items(viewModel.results.toList()) { item ->
                    TvMediaCard(
                        title = item.displayTitle,
                        posterUrl = TMDBImage.url(item.posterPath, TMDBImage.Size.W500),
                        onClick = {
                            viewModel.saveSearchQuery(viewModel.query)
                            onNavigateToDetail(item.id, item.mediaType ?: "movie", 0, 0)
                        }
                    )
                }
            }

            if (viewModel.isSearching) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            }
        }
    }

    if (showGenrePicker) {
        TvGenrePickerDialog(
            availableGenres = viewModel.availableGenres.toList(),
            selectedGenreIds = viewModel.selectedGenreIds.toList(),
            onToggle = viewModel::toggleGenre,
            onClear = viewModel::clearGenreFilters,
            onDismiss = { showGenrePicker = false }
        )
    }

    if (showSortPicker) {
        TvSortPickerDialog(
            field = viewModel.sortField,
            order = viewModel.sortOrder,
            onSortChange = viewModel::onSortChange,
            onDismiss = { showSortPicker = false }
        )
    }
}

// ─────────────────────────────────────────────
// Filter bar composables
// ─────────────────────────────────────────────

@Composable
private fun TvFilterBar(
    mediaTypeFilter: String,
    selectedGenreIds: List<Int>,
    selectedGenreNames: List<String>,
    availableGenres: List<TmdbGenre>,
    sortField: SortField,
    sortOrder: SortOrder,
    onMediaTypeChange: (String) -> Unit,
    onToggleGenre: (Int) -> Unit,
    onClearGenres: () -> Unit,
    onOpenGenrePicker: () -> Unit,
    onOpenSortPicker: () -> Unit
) {
    Column(modifier = Modifier.padding(vertical = 4.dp)) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.weight(1f)
            ) {
                TvFilterChip(
                    label = "Tutti",
                    selected = mediaTypeFilter == "all",
                    onClick = { onMediaTypeChange("all") }
                )
                TvFilterChip(
                    label = "Film",
                    selected = mediaTypeFilter == "movie",
                    onClick = { onMediaTypeChange("movie") }
                )
                TvFilterChip(
                    label = "Serie TV",
                    selected = mediaTypeFilter == "tv",
                    onClick = { onMediaTypeChange("tv") }
                )
            }

            TvSortButton(
                field = sortField,
                order = sortOrder,
                onClick = onOpenSortPicker
            )

            TvFilterButton(
                selectedCount = selectedGenreIds.size,
                onClick = onOpenGenrePicker
            )
        }

        if (selectedGenreNames.isNotEmpty()) {
            TvGenreBadgeRow(
                selectedGenreNames = selectedGenreNames,
                availableGenres = availableGenres,
                onToggleGenre = onToggleGenre,
                modifier = Modifier.padding(top = 8.dp)
            )
        }
    }
}

/** Bottone ordinamento TV: capsula focusable con icona Sort + campo + freccia direzione. */
@Composable
private fun TvSortButton(
    field: SortField,
    order: SortOrder,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    TvFocusable(
        onClick = onClick,
        modifier = modifier
    ) { focused ->
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier
                .height(44.dp)
                .clip(RoundedCornerShape(50))
                .background(
                    if (focused) Color.White.copy(alpha = 0.18f)
                    else Color.White.copy(alpha = 0.08f)
                )
                .border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(50))
                .tvFocusRing(focused, RoundedCornerShape(50))
                .padding(horizontal = 16.dp)
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.Sort,
                contentDescription = "Ordina per ${field.label}, ${order.label}",
                tint = Color.White,
                modifier = Modifier.size(18.dp)
            )
            Text(
                text = field.label,
                style = MaterialTheme.typography.labelLarge,
                color = Color.White
            )
        }
    }
}

@Composable
private fun TvSortPickerDialog(
    field: SortField,
    order: SortOrder,
    onSortChange: (SortField, SortOrder) -> Unit,
    onDismiss: () -> Unit
) {
    Dialog(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .widthIn(min = 400.dp, max = 700.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(Color(0xFF1A1A1A))
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(
                text = "Ordina per",
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onBackground
            )

            FlowRow(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                SortField.entries.forEach { f ->
                    TvGenreChip(
                        label = f.label,
                        selected = field == f,
                        onClick = { onSortChange(f, order) }
                    )
                }
            }

            Text(
                text = "Direzione",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                SortOrder.entries.forEach { o ->
                    TvGenreChip(
                        label = o.label,
                        selected = order == o,
                        onClick = { onSortChange(field, o) }
                    )
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.End)
            ) {
                TvFocusable(onClick = onDismiss) { focused ->
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(
                                if (focused) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.primary.copy(alpha = 0.7f)
                            )
                            .tvFocusRing(focused, RoundedCornerShape(8.dp))
                            .padding(horizontal = 20.dp, vertical = 12.dp)
                    ) {
                        Text(
                            text = "Chiudi",
                            style = MaterialTheme.typography.titleSmall,
                            color = Color.White
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun TvGenreChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    TvFocusable(
        onClick = onClick,
        modifier = modifier
    ) { focused ->
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(50))
                .background(
                    when {
                        selected -> MaterialTheme.colorScheme.primary
                        focused -> Color.White.copy(alpha = 0.18f)
                        else -> Color.White.copy(alpha = 0.08f)
                    }
                )
                .then(
                    if (!selected) {
                        Modifier.border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(50))
                    } else Modifier
                )
                .tvFocusRing(focused, RoundedCornerShape(50))
                .padding(horizontal = 16.dp, vertical = 10.dp)
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelLarge,
                color = if (selected) MaterialTheme.colorScheme.onPrimary else Color.White
            )
        }
    }
}

@Composable
private fun TvFilterChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    TvFocusable(
        onClick = onClick,
        modifier = modifier
    ) { focused ->
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(50))
                .background(
                    when {
                        selected -> MaterialTheme.colorScheme.primary
                        focused -> Color.White.copy(alpha = 0.18f)
                        else -> Color.White.copy(alpha = 0.08f)
                    }
                )
                .then(
                    if (!selected) {
                        Modifier.border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(50))
                    } else Modifier
                )
                .tvFocusRing(focused, RoundedCornerShape(50))
                .padding(horizontal = 16.dp, vertical = 8.dp)
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelLarge,
                color = if (selected) MaterialTheme.colorScheme.onPrimary else Color.White
            )
        }
    }
}

@Composable
private fun TvFilterButton(
    selectedCount: Int,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    TvFocusable(
        onClick = onClick,
        modifier = modifier
    ) { focused ->
        Box(
            modifier = Modifier
                .size(44.dp)
                .clip(RoundedCornerShape(50))
                .background(
                    if (focused) Color.White.copy(alpha = 0.18f)
                    else Color.White.copy(alpha = 0.08f)
                )
                .border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(50))
                .tvFocusRing(focused, RoundedCornerShape(50)),
            contentAlignment = Alignment.Center
        ) {
            if (selectedCount > 0) {
                BadgedBox(
                    badge = {
                        Badge(
                            containerColor = MaterialTheme.colorScheme.primary,
                            contentColor = MaterialTheme.colorScheme.onPrimary
                        ) {
                            Text(
                                text = selectedCount.toString(),
                                style = MaterialTheme.typography.labelSmall
                            )
                        }
                    }
                ) {
                    Icon(
                        imageVector = Icons.Default.FilterList,
                        contentDescription = "Filtri",
                        tint = Color.White
                    )
                }
            } else {
                Icon(
                    imageVector = Icons.Default.FilterList,
                    contentDescription = "Filtri",
                    tint = Color.White
                )
            }
        }
    }
}

@Composable
private fun TvGenreBadgeRow(
    selectedGenreNames: List<String>,
    availableGenres: List<TmdbGenre>,
    onToggleGenre: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    LazyRow(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(selectedGenreNames) { name ->
            TvGenreSummaryChip(
                name = name,
                onRemove = {
                    val id = availableGenres.firstOrNull { it.name == name }?.id
                    id?.let(onToggleGenre)
                }
            )
        }
    }
}

@Composable
private fun TvGenreSummaryChip(
    name: String,
    onRemove: () -> Unit
) {
    TvFocusable(
        onClick = onRemove
    ) { focused ->
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .clip(RoundedCornerShape(50))
                .background(
                    if (focused) MaterialTheme.colorScheme.primary.copy(alpha = 0.7f)
                    else Color.White.copy(alpha = 0.08f)
                )
                .border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(50))
                .tvFocusRing(focused, RoundedCornerShape(50))
                .padding(start = 12.dp, end = 8.dp, top = 6.dp, bottom = 6.dp)
        ) {
            Text(
                text = name,
                style = MaterialTheme.typography.labelLarge,
                color = Color.White,
                modifier = Modifier.padding(end = 4.dp)
            )
            Icon(
                imageVector = Icons.Default.Close,
                contentDescription = "Rimuovi $name",
                tint = Color.White,
                modifier = Modifier.size(16.dp)
            )
        }
    }
}

// ─────────────────────────────────────────────
// Genre picker dialog
// ─────────────────────────────────────────────

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TvGenrePickerDialog(
    availableGenres: List<TmdbGenre>,
    selectedGenreIds: List<Int>,
    onToggle: (Int) -> Unit,
    onClear: () -> Unit,
    onDismiss: () -> Unit
) {
    Dialog(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .widthIn(min = 400.dp, max = 700.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(Color(0xFF1A1A1A))
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(
                text = "Generi",
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onBackground
            )

            if (availableGenres.isEmpty()) {
                Text(
                    text = "Nessun genere disponibile",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            } else {
                FlowRow(
                    modifier = Modifier.verticalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    availableGenres.forEach { genre ->
                        TvGenreChip(
                            label = genre.name,
                            selected = genre.id in selectedGenreIds,
                            onClick = { onToggle(genre.id) }
                        )
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.End)
            ) {
                if (selectedGenreIds.isNotEmpty()) {
                    TvFocusable(onClick = onClear) { focused ->
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (focused) Color.White.copy(alpha = 0.12f) else Color.White.copy(alpha = 0.06f))
                                .tvFocusRing(focused, RoundedCornerShape(8.dp))
                                .padding(horizontal = 20.dp, vertical = 12.dp)
                        ) {
                            Text(
                                text = "Cancella filtri",
                                style = MaterialTheme.typography.titleSmall,
                                color = if (focused) Color.White else MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
                TvFocusable(onClick = onDismiss) { focused ->
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (focused) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.primary.copy(alpha = 0.7f))
                            .tvFocusRing(focused, RoundedCornerShape(8.dp))
                            .padding(horizontal = 20.dp, vertical = 12.dp)
                    ) {
                        Text(
                            text = "Chiudi",
                            style = MaterialTheme.typography.titleSmall,
                            color = Color.White
                        )
                    }
                }
            }
        }
    }
}
