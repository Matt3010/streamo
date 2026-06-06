package com.streamo.app.ui.tv.common

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearProgressIndicator
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
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.streamo.app.ui.common.ImagePlaceholder

/**
 * D-pad–focusable progress card for TV. Replaces `ProgressMediaCard` on TV.
 * The whole card is a single focus target — the play/remove sub-buttons of the
 * phone variant collapse into one click that opens the detail/player.
 *
 * Supports both poster (2:3) and still (16:9) shapes via [aspectRatio].
 */
@Composable
fun TvProgressMediaCard(
    title: String,
    posterUrl: String?,
    modifier: Modifier = Modifier,
    width: Dp = 140.dp,
    aspectRatio: Float = 2f / 3f,
    season: Int? = null,
    episode: Int? = null,
    positionSeconds: Double = 0.0,
    durationSeconds: Double = 0.0,
    statusText: String? = null,
    focusRequester: FocusRequester? = null,
    onClick: () -> Unit = {}
) {
    val pct = if (durationSeconds > 0) {
        (positionSeconds / durationSeconds).toFloat().coerceIn(0f, 1f)
    } else 0f

    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val scale by animateFloatAsState(
        targetValue = if (focused) 1.08f else 1f,
        animationSpec = tween(durationMillis = 150),
        label = "tvProgressCardScale"
    )

    Column(
        modifier = modifier
            .width(width)
            .then(if (focusRequester != null) Modifier.focusRequester(focusRequester) else Modifier)
            .clickable(
                interactionSource = interaction,
                indication = null,
                onClick = onClick
            ),
        horizontalAlignment = Alignment.CenterHorizontally
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
                    .aspectRatio(aspectRatio)
                    .clip(RoundedCornerShape(9.dp))
                    .background(Color(0xFF1E1E1E)),
                contentAlignment = Alignment.Center
            ) {
                if (posterUrl != null) {
                    AsyncImage(
                        model = posterUrl,
                        contentDescription = title,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize()
                    )
                } else {
                    ImagePlaceholder(label = title)
                }

                // Bottom gradient overlay
                Box(
                    modifier = Modifier
                        .matchParentSize()
                        .background(
                            Brush.verticalGradient(
                                colors = listOf(Color.Transparent, Color.Black.copy(alpha = 0.5f))
                            )
                        )
                )

                // Season/Episode badge (top-left) with dark semi-transparent background
                if (season != null && episode != null) {
                    Box(
                        modifier = Modifier
                            .padding(8.dp)
                            .align(Alignment.TopStart)
                            .clip(RoundedCornerShape(6.dp))
                            .background(Color.Black.copy(alpha = 0.55f))
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    ) {
                        Text(
                            text = "S${season} E${episode}",
                            style = MaterialTheme.typography.labelSmall,
                            color = Color.White
                        )
                    }
                }

                // Progress bar at bottom — visible minimum sliver once started
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
            }
        }

        Text(
            text = title,
            style = MaterialTheme.typography.labelMedium,
            color = if (focused) Color.White else MaterialTheme.colorScheme.onBackground,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp)
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
