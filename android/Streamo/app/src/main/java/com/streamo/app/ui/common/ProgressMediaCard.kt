package com.streamo.app.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.streamo.app.tmdb.TMDBImage

/**
 * A media card that shows a poster with an optional progress bar, season/episode badge,
 * and an optional centered play button. Used for Continue Watching, Watchlist, and History.
 */
@Composable
fun ProgressMediaCard(
    title: String,
    posterUrl: String?,
    modifier: Modifier = Modifier,
    width: Dp = 140.dp,
    aspectRatio: Float = 2f / 3f,
    season: Int? = null,
    episode: Int? = null,
    positionSeconds: Double = 0.0,
    durationSeconds: Double = 0.0,
    /** Overrides the default "X min rimasti" line when non-null (e.g. "Completato"). */
    statusText: String? = null,
    showPlayButton: Boolean = false,
    onClick: () -> Unit = {},
    onPlay: () -> Unit = {},
    onRemove: (() -> Unit)? = null
) {
    val pct = if (durationSeconds > 0) {
        (positionSeconds / durationSeconds).toFloat().coerceIn(0f, 1f)
    } else 0f

    Column(
        modifier = modifier
            .width(width)
            .clickable(onClick = onClick)
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(aspectRatio)
                .clip(RoundedCornerShape(10.dp))
                .background(Color(0xFF1E1E1E))
        ) {
            if (posterUrl != null) {
                AsyncImage(
                    model = posterUrl,
                    contentDescription = title,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxWidth()
                )
            }
            // Bottom gradient overlay
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .matchParentSize()
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(
                                Color.Transparent,
                                Color.Black.copy(alpha = 0.5f)
                            )
                        )
                    )
            )
            // Season/Episode badge (top-left)
            if (season != null && episode != null) {
                Box(
                    modifier = Modifier
                        .padding(8.dp)
                        .align(Alignment.TopStart)
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color.Black.copy(alpha = 0.7f))
                        .padding(horizontal = 6.dp, vertical = 2.dp)
                ) {
                    Text(
                        text = "S${season} E${episode}",
                        style = MaterialTheme.typography.labelSmall,
                        color = Color.White
                    )
                }
            }
            // Play button (bottom-end, over the existing dark gradient)
            if (showPlayButton) {
                IconButton(
                    onClick = onPlay,
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .size(36.dp)
                ) {
                    Icon(
                        imageVector = Icons.Filled.PlayCircle,
                        contentDescription = "Riprendi",
                        tint = Color.White.copy(alpha = 0.95f),
                        modifier = Modifier.size(28.dp)
                    )
                }
            }
            // Progress bar at bottom — keep a visible minimum sliver once started.
            if (pct > 0f) {
                LinearProgressIndicator(
                    progress = { pct.coerceAtLeast(0.04f) },
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .fillMaxWidth()
                        .height(3.dp),
                    color = MaterialTheme.colorScheme.primary,
                    trackColor = Color.Transparent,
                )
            }
            // Remove button (top-right)
            if (onRemove != null) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(4.dp)
                        .size(24.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color.Black.copy(alpha = 0.55f))
                        .clickable(onClick = onRemove),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Filled.Close,
                        contentDescription = "Rimuovi",
                        tint = Color.White.copy(alpha = 0.9f),
                        modifier = Modifier.size(14.dp)
                    )
                }
            }
        }
        Text(
            text = title,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onBackground,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 6.dp)
        )
        val timeText = statusText ?: if (durationSeconds > 0) {
            val remainingSec = (durationSeconds - positionSeconds).toInt().coerceAtLeast(0)
            val h = remainingSec / 3600
            val m = (remainingSec % 3600) / 60
            when {
                h > 0 -> "${h}h ${m}min rimasti"
                m > 0 -> "${m} min rimasti"
                else -> "pochi secondi"
            }
        } else null
        timeText?.let {
            Text(
                text = it,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}
