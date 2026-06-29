package com.streamo.app.ui.common

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import coil.compose.AsyncImage

@Composable
fun MediaCard(
    title: String,
    posterUrl: String?,
    modifier: Modifier = Modifier,
    width: Dp = 140.dp,
    aspectRatio: Float = 2f / 3f,
    year: Int? = null,
    rating: Double? = null,
    showInfo: Boolean = true,
    overlayContent: @Composable BoxScope.() -> Unit = {},
    onClick: () -> Unit = {}
) {
    val interactionSource = remember { MutableInteractionSource() }
    val isPressed by interactionSource.collectIsPressedAsState()

    val scale by animateFloatAsState(
        targetValue = if (isPressed) 0.94f else 1f,
        animationSpec = spring(
            dampingRatio = 0.65f,
            stiffness = 350f,
            visibilityThreshold = 0.001f
        ),
        label = "scale"
    )

    val elevation by animateFloatAsState(
        targetValue = if (isPressed) 16f else 0f,
        animationSpec = spring(
            dampingRatio = 0.7f,
            stiffness = 300f,
            visibilityThreshold = 0.1f
        ),
        label = "elevation"
    )

    val tintAlpha by animateFloatAsState(
        targetValue = if (isPressed) 0.25f else 0f,
        animationSpec = spring(
            dampingRatio = 0.8f,
            stiffness = 400f,
            visibilityThreshold = 0.01f
        ),
        label = "tint"
    )

    Column(
        modifier = modifier
            .width(width)
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
                this.shadowElevation = elevation
            }
            .clickable(interactionSource = interactionSource, indication = null, onClick = onClick)
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
                    modifier = Modifier.fillMaxSize()
                )
            } else {
                ImagePlaceholder(modifier = Modifier.fillMaxSize())
            }
            // Press highlight overlay
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.White.copy(alpha = tintAlpha))
            )
            // Overlay caller (badge ITA, ecc.) — dentro il poster clippato.
            overlayContent()
        }
        if (showInfo) {
            Column(
                modifier = Modifier
                    .padding(top = 6.dp)
                    .height(48.dp)
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onBackground,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                val meta = buildList {
                    year?.let { add(it.toString()) }
                    rating?.takeIf { it > 0.0 }?.let { add("★ ${"%.1f".format(it)}") }
                }.joinToString("  ·  ")
                if (meta.isNotEmpty()) {
                    Text(
                        text = meta,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(top = 2.dp)
                    )
                }
            }
        }
    }
}

@Composable
fun SkeletonCard(
    modifier: Modifier = Modifier,
    width: Dp = 140.dp
) {
    Column(
        modifier = modifier.width(width)
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(2f / 3f)
                .clip(RoundedCornerShape(10.dp))
                .background(Color(0xFF1E1E1E))
        )
        Column(
            modifier = Modifier
                .padding(top = 6.dp)
                .height(48.dp)
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(0.7f)
                    .height(12.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(Color(0xFF1E1E1E))
            )
            Box(
                modifier = Modifier
                    .padding(top = 8.dp)
                    .fillMaxWidth(0.4f)
                    .height(10.dp)
                    .clip(RoundedCornerShape(5.dp))
                    .background(Color(0xFF1E1E1E))
            )
        }
    }
}
