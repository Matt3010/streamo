package com.streamo.app.ui.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.streamo.app.data.remote.dto.TmdbItem
import com.streamo.app.tmdb.TMDBImage
import com.streamo.app.ui.common.MediaCard
import com.streamo.app.ui.common.SectionHeader

private val PosterWidth = 110.dp
private val PosterHeight = PosterWidth * 1.5f   // poster 2:3

/**
 * Riga "Top 10" stile Netflix: carosello orizzontale dove ogni poster è
 * preceduto da un grande numerale fantasma (1…10) che il poster sovrappone
 * (come iOS Top10Row).
 */
@Composable
fun Top10Row(
    items: List<TmdbItem>,
    showInfo: Boolean,
    onItemClick: (TmdbItem) -> Unit,
    modifier: Modifier = Modifier
) {
    if (items.isEmpty()) return

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        SectionHeader(
            title = "Top 10 oggi",
            icon = Icons.Filled.BarChart
        )

        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            itemsIndexed(items, key = { _, item -> item.id }) { index, item ->
                Top10Card(
                    rank = index + 1,
                    item = item,
                    showInfo = showInfo,
                    onClick = { onItemClick(item) }
                )
            }
        }
    }
}

@Composable
private fun Top10Card(
    rank: Int,
    item: TmdbItem,
    showInfo: Boolean,
    onClick: () -> Unit
) {
    // Sovrapposizione leggera: il poster copre solo il bordo destro del
    // numerale, così un "1" stretto resta quasi tutto visibile mentre un
    // "2"/"10" largo si estende più a sinistra e rimane intero.
    // indication = null: la card interna (MediaCard) ha già il proprio
    // press-feedback (scale/elevation/tint); un ripple qui duplicherebbe il
    // feedback visivo nell'area di sovrapposizione. Il click sul Row resta
    // solo per estendere il target al numerale, che la card non copre del tutto.
    val rowInteractionSource = remember { MutableInteractionSource() }
    Row(
        modifier = Modifier.clickable(
            interactionSource = rowInteractionSource,
            indication = null,
            onClick = onClick
        ),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(-PosterWidth * 0.2f)
    ) {
        Box(
            modifier = Modifier
                .height(PosterHeight)
                .clipToBounds(),
            contentAlignment = Alignment.BottomStart
        ) {
            // Numerale pieno semi-trasparente: il poster gli si sovrappone
            // da destra. Fill (non Stroke) evita linee interne antiestetiche
            // su cifre come 8/0/6/9/4.
            Text(
                text = rank.toString(),
                style = TextStyle(
                    fontSize = 132.sp,
                    fontWeight = FontWeight.Black,
                    color = Color.White.copy(alpha = 0.5f)
                ),
                maxLines = 1,
                softWrap = false
            )
        }

        MediaCard(
            title = item.displayTitle,
            posterUrl = TMDBImage.url(item.posterPath, TMDBImage.Size.W500),
            width = PosterWidth,
            year = item.year,
            rating = item.voteAverage,
            showInfo = showInfo,
            onClick = onClick
        )
    }
}
