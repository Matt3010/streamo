package com.streamo.app.ui.tv.search

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.streamo.app.tmdb.TMDBImage
import com.streamo.app.ui.common.AmbientBackground
import com.streamo.app.ui.search.SearchViewModel
import com.streamo.app.ui.tv.common.TvFocusable
import com.streamo.app.ui.tv.common.TvMediaCard

/**
 * TV Search screen. OutlinedTextField (focus → system/leanback IME opens
 * automatically on TV/Fire TV) + focusable grid of results.
 */
@Composable
fun TvSearchScreen(
    onNavigateToDetail: (Int, String, Int, Int) -> Unit = { _, _, _, _ -> },
    viewModel: SearchViewModel = hiltViewModel()
) {
    val searchFieldFocusRequester = remember { FocusRequester() }
    val gridState = rememberLazyGridState()

    LaunchedEffect(Unit) {
        searchFieldFocusRequester.requestFocus()
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
                            onClick = { viewModel.onQueryChange(historyQuery) },
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
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            }
        }
    }
}