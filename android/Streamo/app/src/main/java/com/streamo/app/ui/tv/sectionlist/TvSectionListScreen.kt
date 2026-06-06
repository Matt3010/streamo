package com.streamo.app.ui.tv.sectionlist

import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.streamo.app.ui.common.AmbientBackground
import com.streamo.app.ui.tv.common.TvMediaCard
import com.streamo.app.tmdb.TMDBImage
import com.streamo.app.ui.sectionlist.SectionListViewModel

/**
 * TV Section List screen — focusable grid reached from "see all" on a Home row.
 * Reuses [SectionListViewModel] unchanged.
 */
@Composable
fun TvSectionListScreen(
    onNavigateToDetail: (Int, String, Int, Int) -> Unit = { _, _, _, _ -> },
    onBack: () -> Unit = {},
    viewModel: SectionListViewModel = hiltViewModel()
) {
    val title by viewModel.title.collectAsState()
    val items by viewModel.items.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()
    val hasMore by viewModel.hasMore.collectAsState()
    val initialFocusRequester = remember { FocusRequester() }
    val gridState = rememberLazyGridState()

    LaunchedEffect(Unit) {
        initialFocusRequester.requestFocus()
    }

    // Paging: load more when within ~10 of the end.
    LaunchedEffect(gridState, items.size, hasMore, isLoading) {
        snapshotFlow { gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }
            .collect { lastVisible ->
                if (hasMore && !isLoading && items.isNotEmpty() && lastVisible >= items.size - 10) {
                    viewModel.loadMore()
                }
            }
    }

    AmbientBackground()

    LazyVerticalGrid(
        columns = GridCells.Fixed(5),
        state = gridState,
        modifier = Modifier
            .focusRequester(initialFocusRequester)
            .focusable()
            .fillMaxSize()
            .padding(horizontal = 32.dp, vertical = 16.dp),
        contentPadding = PaddingValues(bottom = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // Title
        item(span = { GridItemSpan(5) }) {
            Text(
                text = title,
                style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.onBackground,
                modifier = Modifier.padding(bottom = 8.dp)
            )
        }

        if (items.isEmpty() && isLoading) {
            item(span = { GridItemSpan(5) }) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            }
        } else {
            items(items) { item ->
                TvMediaCard(
                    title = item.displayTitle,
                    posterUrl = TMDBImage.url(item.posterPath, TMDBImage.Size.W500),
                    onClick = {
                        onNavigateToDetail(item.id, viewModel.mediaType, 0, 0)
                    }
                )
            }
        }
    }
}