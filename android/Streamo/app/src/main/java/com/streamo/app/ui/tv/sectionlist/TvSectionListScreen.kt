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
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import kotlinx.coroutines.delay
import com.streamo.app.ui.common.AmbientBackground
import com.streamo.app.ui.tv.common.TvMediaCard
import com.streamo.app.tmdb.TMDBImage
import com.streamo.app.ui.sectionlist.SectionListViewModel

/**
 * TV Section List screen — focusable grid reached from the "Altro" card at the end of
 * a Home row. Reuses [SectionListViewModel] unchanged. Since the row shares the same
 * endpoint, initial focus lands on the LAST loaded card (where the user left off in the
 * row), so D-pad continues naturally — never on the empty grid container.
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
    val lastCardFocus = remember { FocusRequester() }
    val loadingFocus = remember { FocusRequester() }
    val gridState = rememberLazyGridState()

    // While the first page loads keep focus on the spinner anchor so the nav rail can't
    // grab focus and auto-open. Stops once items arrive (then focus moves to last card).
    LaunchedEffect(items.isEmpty()) {
        while (items.isEmpty()) {
            runCatching { loadingFocus.requestFocus() }
            delay(16)
        }
    }

    // Initial focus on the last loaded card, once — not on every paging append (that
    // would yank focus to the bottom each time more loads).
    var didInitialFocus by remember { mutableStateOf(false) }
    LaunchedEffect(items.size) {
        if (!didInitialFocus && items.isNotEmpty()) {
            didInitialFocus = true
            // Grid opens scrolled to the top, so the last card is likely below the fold and
            // LazyVerticalGrid hasn't composed it yet — requestFocus() on an uncomposed item
            // throws (swallowed by runCatching) and focus is left stranded. The spinner Box
            // (which held focus) is disposed the instant items arrive, so any delay before the
            // first attempt here is a gap where focus has nowhere to land and escapes to the
            // nav rail (NavigationDrawer ties its open/closed state directly to real D-pad
            // focus, so it stays visibly open until something reclaims it) — scroll the target
            // into view, then retry immediately, every frame, no upfront delay.
            gridState.scrollToItem(items.lastIndex)
            repeat(30) {
                if (runCatching { lastCardFocus.requestFocus() }.getOrDefault(false)) {
                    return@LaunchedEffect
                }
                delay(16)
            }
        }
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
                    modifier = Modifier
                        .fillMaxSize()
                        .focusRequester(loadingFocus)
                        .focusable(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            }
        } else {
            itemsIndexed(items) { index, item ->
                TvMediaCard(
                    title = item.displayTitle,
                    posterUrl = TMDBImage.url(item.posterPath, TMDBImage.Size.W500),
                    focusRequester = if (index == items.lastIndex) lastCardFocus else null,
                    onClick = {
                        onNavigateToDetail(item.id, viewModel.mediaType, 0, 0)
                    }
                )
            }
        }
    }
}
