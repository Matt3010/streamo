package com.streamo.app.ui.tv.common

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.snapshotFlow
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import com.streamo.app.data.remote.dto.TmdbItem
import com.streamo.app.tmdb.TMDBImage
import com.streamo.app.ui.home.HomeSection

/**
 * Binds a Home section to [TvImmersiveRow]. Replicates the phone SectionRow paging
 * (snapshotFlow on visible items, call onLoadMore when within ~3 of the end).
 */
@Composable
fun TvSectionRow(
    section: HomeSection,
    items: List<TmdbItem>,
    loading: Boolean,
    onItemClick: (TmdbItem) -> Unit,
    onHeaderClick: () -> Unit,
    onLoadMore: () -> Unit,
    modifier: Modifier = Modifier,
    firstCardFocusRequester: FocusRequester? = null
) {
    if (items.isEmpty() && !loading) return

    val rowState = rememberLazyListState()

    LaunchedEffect(rowState, items.size) {
        snapshotFlow { rowState.layoutInfo.visibleItemsInfo }
            .collect { visibleItems ->
                if (visibleItems.isNotEmpty() && items.isNotEmpty()) {
                    val lastVisible = visibleItems.last().index
                    if (lastVisible >= items.size - 3) {
                        onLoadMore()
                    }
                }
            }
    }

    TvImmersiveRow(
        title = section.title,
        modifier = modifier,
        icon = section.icon,
        lazyListState = rowState,
        onHeaderClick = onHeaderClick
    ) {
        if (items.isEmpty()) {
            // Show skeleton placeholders while loading
            items(6) {
                TvMediaCard(
                    title = "",
                    posterUrl = null
                )
            }
        } else {
            items(items.size) { index ->
                val item = items[index]
                TvMediaCard(
                    title = item.displayTitle,
                    posterUrl = TMDBImage.url(item.posterPath, TMDBImage.Size.W500),
                    focusRequester = if (index == 0) firstCardFocusRequester else null,
                    onClick = { onItemClick(item) }
                )
            }
        }
    }
}