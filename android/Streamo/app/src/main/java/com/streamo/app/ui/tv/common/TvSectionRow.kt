package com.streamo.app.ui.tv.common

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.streamo.app.data.remote.dto.TmdbItem
import com.streamo.app.tmdb.TMDBImage
import com.streamo.app.ui.home.HomeSection

const val TV_HOME_ROW_LIMIT = 10

/**
 * Binds a Home section to [TvImmersiveRow]. The row shows the loaded titles followed by
 * a trailing "Altro" card when more than [TV_HOME_ROW_LIMIT] titles are available — no
 * clickable header (awkward to reach with D-pad).
 *
 * [focusRequester] is attached to the card whose id is [focusItemId] (initial/restored
 * focus target, driven by the Home screen); no card gets it when [focusItemId] is null.
 */
@Composable
fun TvSectionRow(
    section: HomeSection,
    items: List<TmdbItem>,
    loading: Boolean,
    onItemClick: (TmdbItem) -> Unit,
    onMoreClick: () -> Unit,
    modifier: Modifier = Modifier,
    focusRequester: FocusRequester? = null,
    focusItemId: Int? = null
) {
    if (items.isEmpty() && !loading) return
    val visibleItems = items.take(TV_HOME_ROW_LIMIT)

    TvImmersiveRow(
        title = section.title,
        modifier = modifier,
        icon = section.icon
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
            items(visibleItems, key = { it.id }) { item ->
                TvMediaCard(
                    title = item.displayTitle,
                    posterUrl = TMDBImage.url(item.posterPath, TMDBImage.Size.W500),
                    focusRequester = focusRequester.takeIf { focusItemId != null && item.id == focusItemId },
                    onClick = { onItemClick(item) }
                )
            }
            if (items.size > visibleItems.size) {
                item {
                    TvLoadMoreCard(onClick = onMoreClick)
                }
            }
        }
    }
}

/**
 * Trailing "Altro" card. Same poster footprint as [TvMediaCard] so the row stays
 * aligned; clicking opens the full list. An empty label keeps the bottom baseline
 * aligned with the titled cards beside it.
 */
@Composable
fun TvLoadMoreCard(
    onClick: () -> Unit,
    width: Dp = 140.dp
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val scale by animateFloatAsState(
        targetValue = if (focused) 1.05f else 1f,
        animationSpec = tween(durationMillis = 150),
        label = "tvLoadMoreScale"
    )

    Column(
        modifier = Modifier
            .width(width)
            .clickable(
                interactionSource = interaction,
                indication = null,
                onClick = onClick
            ),
        horizontalAlignment = Alignment.Start
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .scale(scale)
                .tvFocusFrame(focused)
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(2f / 3f)
                    .clip(RoundedCornerShape(9.dp))
                    .background(Color.White.copy(alpha = if (focused) 0.18f else 0.08f)),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        imageVector = Icons.Filled.ArrowForward,
                        contentDescription = "Altro",
                        tint = if (focused) Color.White else Color.White.copy(alpha = 0.7f)
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Altro",
                        style = MaterialTheme.typography.labelLarge,
                        color = if (focused) Color.White else Color.White.copy(alpha = 0.7f)
                    )
                }
            }
        }
        Text(
            text = "",
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp)
        )
    }
}
