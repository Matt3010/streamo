package com.streamo.app.ui.search

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.streamo.app.data.remote.dto.TmdbGenre
import com.streamo.app.data.remote.dto.TmdbItem
import com.streamo.app.navigation.LocalBottomBarPadding
import com.streamo.app.tmdb.TMDBImage
import com.streamo.app.ui.common.GlassAlertDialog
import com.streamo.app.ui.common.GlassDefaults
import com.streamo.app.ui.common.GlassDialogDestructiveButton
import com.streamo.app.ui.common.GlassDialogNeutralButton
import com.streamo.app.ui.common.GlassDialogPrimaryButton
import com.streamo.app.ui.common.GlassFilterChip
import com.streamo.app.ui.common.LocalHazeState
import com.streamo.app.ui.common.MediaCard
import com.streamo.app.ui.common.SkeletonCard
import com.streamo.app.ui.common.LocalWindowSizeClass
import com.streamo.app.ui.common.cardWidth
import com.streamo.app.ui.common.contentPadding
import com.streamo.app.ui.common.itemSpacing

@Composable
fun SearchScreen(
    onNavigateToDetail: (Int, String, Int, Int) -> Unit = { _, _, _, _ -> },
    viewModel: SearchViewModel = hiltViewModel()
) {
    val windowSizeClass = LocalWindowSizeClass.current
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
            .padding(horizontal = windowSizeClass.contentPadding)
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

            // Barra filtri: tipo media sempre visibile, generi dentro modale
            FilterBar(
                mediaTypeFilter = viewModel.mediaTypeFilter,
                selectedGenreIds = viewModel.selectedGenreIds,
                availableGenres = viewModel.availableGenres,
                selectedGenreNames = viewModel.selectedGenreNames,
                sortField = viewModel.sortField,
                sortOrder = viewModel.sortOrder,
                onMediaTypeChange = viewModel::onMediaTypeFilterChange,
                onToggleGenre = viewModel::toggleGenre,
                onClearGenres = viewModel::clearGenreFilters,
                onSortChange = viewModel::onSortChange
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
                        columns = GridCells.Adaptive(minSize = windowSizeClass.cardWidth),
                        contentPadding = PaddingValues(top = 8.dp, bottom = 8.dp + LocalBottomBarPadding.current, start = windowSizeClass.contentPadding, end = windowSizeClass.contentPadding),
                        horizontalArrangement = Arrangement.spacedBy(windowSizeClass.itemSpacing),
                        verticalArrangement = Arrangement.spacedBy(windowSizeClass.itemSpacing)
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
                        columns = GridCells.Adaptive(minSize = windowSizeClass.cardWidth),
                        contentPadding = PaddingValues(top = 8.dp, bottom = 8.dp + LocalBottomBarPadding.current, start = windowSizeClass.contentPadding, end = windowSizeClass.contentPadding),
                        horizontalArrangement = Arrangement.spacedBy(windowSizeClass.itemSpacing),
                        verticalArrangement = Arrangement.spacedBy(windowSizeClass.itemSpacing)
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

        var queryToDelete by remember { mutableStateOf<String?>(null) }

        // Overlay cronologia sotto search box
        if (viewModel.isSearchFieldFocused && viewModel.query.trim().length < 2) {
            SearchHistoryDropdown(
                history = viewModel.searchHistory,
                onQueryClick = { viewModel.onQueryChange(it) },
                onDelete = { queryToDelete = it },
                modifier = Modifier
                    .padding(top = 60.dp)
                    .fillMaxWidth()
            )
        }

        queryToDelete?.let { query ->
            GlassAlertDialog(
                onDismissRequest = { queryToDelete = null },
                hazeState = LocalHazeState.current,
                title = "Elimina ricerca",
                text = { Text("Eliminare \"$query\" dalle ricerche recenti?") },
                confirmButton = {
                    GlassDialogDestructiveButton(
                        onClick = {
                            viewModel.deleteSearchQuery(query)
                            queryToDelete = null
                        }
                    ) {
                        Text("Elimina")
                    }
                },
                dismissButton = {
                    GlassDialogNeutralButton(onClick = { queryToDelete = null }) {
                        Text("Annulla")
                    }
                }
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
    selectedGenreIds: List<Int>,
    availableGenres: List<TmdbGenre>,
    selectedGenreNames: List<String>,
    sortField: SortField,
    sortOrder: SortOrder,
    onMediaTypeChange: (String) -> Unit,
    onToggleGenre: (Int) -> Unit,
    onClearGenres: () -> Unit,
    onSortChange: (SortField, SortOrder) -> Unit
) {
    var showGenrePicker by remember { mutableStateOf(false) }
    var showSortPicker by remember { mutableStateOf(false) }

    Column(modifier = Modifier.padding(vertical = 4.dp)) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.weight(1f)
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

            SortButton(
                field = sortField,
                order = sortOrder,
                onClick = { showSortPicker = true }
            )

            FilterButton(
                selectedCount = selectedGenreIds.size,
                onClick = { showGenrePicker = true }
            )
        }

        if (selectedGenreNames.isNotEmpty()) {
            GenreBadgeRow(
                selectedGenreNames = selectedGenreNames,
                availableGenres = availableGenres,
                onToggleGenre = onToggleGenre,
                modifier = Modifier.padding(top = 8.dp)
            )
        }
    }

    if (showGenrePicker) {
        GenrePickerDialog(
            availableGenres = availableGenres,
            selectedGenreIds = selectedGenreIds,
            onToggle = onToggleGenre,
            onClear = onClearGenres,
            onDismiss = { showGenrePicker = false }
        )
    }

    if (showSortPicker) {
        SortPickerDialog(
            field = sortField,
            order = sortOrder,
            onSortChange = onSortChange,
            onDismiss = { showSortPicker = false }
        )
    }
}

/** Capsula glass che mostra il campo + la direzione di ordinamento correnti. */
@Composable
private fun SortButton(
    field: SortField,
    order: SortOrder,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    IconButton(
        onClick = onClick,
        modifier = modifier
            .size(44.dp)
            .clip(GlassDefaults.ChipShape)
            .background(GlassDefaults.Container)
    ) {
        Icon(
            imageVector = Icons.AutoMirrored.Filled.Sort,
            contentDescription = "Ordina per ${field.label}, ${order.label}",
            tint = Color.White
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SortPickerDialog(
    field: SortField,
    order: SortOrder,
    onSortChange: (SortField, SortOrder) -> Unit,
    onDismiss: () -> Unit
) {
    GlassAlertDialog(
        onDismissRequest = onDismiss,
        title = "Ordina per",
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    SortField.entries.forEach { f ->
                        GlassFilterChip(
                            label = f.label,
                            selected = field == f,
                            onClick = { onSortChange(f, order) }
                        )
                    }
                }

                Text(
                    text = "Direzione",
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    SortOrder.entries.forEach { o ->
                        GlassFilterChip(
                            label = o.label,
                            selected = order == o,
                            onClick = { onSortChange(field, o) }
                        )
                    }
                }
            }
        },
        confirmButton = {
            GlassDialogPrimaryButton(onClick = onDismiss) {
                Text("Chiudi")
            }
        }
    )
}

@Composable
private fun GenreBadgeRow(
    selectedGenreNames: List<String>,
    availableGenres: List<TmdbGenre>,
    onToggleGenre: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    val scrollState = rememberScrollState()
    val canScrollLeft = scrollState.value > 0
    val canScrollRight = scrollState.value < scrollState.maxValue
    val fadeBg = MaterialTheme.colorScheme.background.copy(alpha = 0.95f)
    val arrowOverlayWidth = 56.dp

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(scrollState),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            selectedGenreNames.forEach { name ->
                GenreSummaryChip(
                    name = name,
                    onRemove = {
                        val id = availableGenres.firstOrNull { it.name == name }?.id
                        id?.let(onToggleGenre)
                    }
                )
            }
        }

        // Fade sinistro
        Box(
            modifier = Modifier
                .align(Alignment.CenterStart)
                .width(arrowOverlayWidth)
                .fillMaxHeight()
                .then(
                    if (canScrollLeft) {
                        Modifier.background(
                            Brush.horizontalGradient(
                                colors = listOf(fadeBg, Color.Transparent)
                            )
                        )
                    } else Modifier
                )
        )

        // Fade destro
        Box(
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .width(arrowOverlayWidth)
                .fillMaxHeight()
                .then(
                    if (canScrollRight) {
                        Modifier.background(
                            Brush.horizontalGradient(
                                colors = listOf(Color.Transparent, fadeBg)
                            )
                        )
                    } else Modifier
                )
        )
    }
}

@Composable
private fun FilterButton(
    selectedCount: Int,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    IconButton(
        onClick = onClick,
        modifier = modifier
            .size(44.dp)
            .clip(GlassDefaults.ChipShape)
            .background(GlassDefaults.Container)
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

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun GenrePickerDialog(
    availableGenres: List<TmdbGenre>,
    selectedGenreIds: List<Int>,
    onToggle: (Int) -> Unit,
    onClear: () -> Unit,
    onDismiss: () -> Unit
) {
    val hasSelection = selectedGenreIds.isNotEmpty()

    GlassAlertDialog(
        onDismissRequest = onDismiss,
        title = "Generi",
        text = {
            Column {
                if (availableGenres.isEmpty()) {
                    Text(
                        text = "Nessun genere disponibile",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                } else {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        availableGenres.forEach { genre ->
                            GlassFilterChip(
                                label = genre.name,
                                selected = genre.id in selectedGenreIds,
                                onClick = { onToggle(genre.id) }
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            GlassDialogPrimaryButton(onClick = onDismiss) {
                Text("Chiudi")
            }
        },
        dismissButton = if (hasSelection) {
            {
                TextButton(onClick = onClear) {
                    Text(
                        text = "Cancella filtri",
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        } else null
    )
}

@Composable
private fun GenreSummaryChip(
    name: String,
    onRemove: () -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .clip(GlassDefaults.ChipShape)
            .background(GlassDefaults.Container)
            .padding(start = 12.dp, end = 4.dp, top = 6.dp, bottom = 6.dp)
    ) {
        Text(
            text = name,
            style = MaterialTheme.typography.labelLarge,
            color = Color.White,
            modifier = Modifier.padding(end = 4.dp)
        )
        IconButton(
            onClick = onRemove,
            modifier = Modifier.size(18.dp)
        ) {
            Icon(
                imageVector = Icons.Default.Close,
                contentDescription = "Rimuovi $name",
                tint = Color.White,
                modifier = Modifier.size(16.dp)
            )
        }
    }
}