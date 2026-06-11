package com.streamo.app.ui.tv.common

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp

/**
 * A labeled horizontal row for TV, using Compose Foundation [LazyRow]
 * (NOT tv-foundation's TvLazyRow — deprecated).
 *
 * - Optional [icon] renders the same primary-tinted rounded badge as the phone
 *   `SectionHeader` before the title.
 * - `focusGroup` + `focusRestorer`: remembers last-focused column on vertical D-pad.
 * - `contentPadding`: leaves room for the 1.08× scaled + bordered focused card.
 */
@Composable
fun TvImmersiveRow(
    title: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    lazyListState: LazyListState = rememberLazyListState(),
    onHeaderClick: (() -> Unit)? = null,
    content: LazyListScope.() -> Unit
) {
    Column(modifier = modifier.fillMaxWidth()) {
        val interactionSource = remember { MutableInteractionSource() }
        val focused by interactionSource.collectIsFocusedAsState()
        val headerMod = Modifier
            .padding(start = 16.dp, end = 16.dp, bottom = 8.dp)
            .then(
                if (onHeaderClick != null) {
                    Modifier
                        .focusable(interactionSource = interactionSource)
                        .clickable(onClick = onHeaderClick)
                } else Modifier
            )
        TvSectionTitle(
            title = title,
            icon = icon,
            highlighted = focused,
            modifier = headerMod
        )
        LazyRow(
            modifier = Modifier
                .fillMaxWidth()
                .focusGroup()
                .focusRestorer(),
            state = lazyListState,
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            content = content
        )
    }
}

/**
 * Section title with the optional primary rounded icon badge — mirrors the phone
 * `SectionHeader` look. Reusable for non-row section titles (e.g. Detail headers).
 */
@Composable
fun TvSectionTitle(
    title: String,
    icon: ImageVector?,
    modifier: Modifier = Modifier,
    highlighted: Boolean = false
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (icon != null) {
            Box(
                modifier = Modifier
                    .size(30.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(MaterialTheme.colorScheme.primary),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onPrimary,
                    modifier = Modifier.size(16.dp)
                )
            }
            Spacer(modifier = Modifier.width(10.dp))
        }
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            color = if (highlighted) MaterialTheme.colorScheme.primary
            else MaterialTheme.colorScheme.onBackground
        )
    }
}
