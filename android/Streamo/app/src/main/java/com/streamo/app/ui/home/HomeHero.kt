package com.streamo.app.ui.home

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.min
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.streamo.app.data.remote.dto.TmdbItem
import com.streamo.app.tmdb.TMDBImage
import com.streamo.app.ui.common.BrandButton
import com.streamo.app.ui.common.BrandIconButton
import kotlinx.coroutines.launch

/** Millisecondi prima dell'auto-avanzamento di ogni slide. */
private const val SLIDE_INTERVAL_MS = 7000f

@Composable
fun HomeHero(
    items: List<TmdbItem>,
    isInWatchlist: (TmdbItem) -> Boolean,
    onPlay: (TmdbItem) -> Unit,
    onToggleWatchlist: (TmdbItem) -> Unit,
    onOpen: (TmdbItem) -> Unit,
    modifier: Modifier = Modifier
) {
    if (items.isEmpty()) return

    val pagerState = rememberPagerState(pageCount = { items.size })
    val scope = rememberCoroutineScope()
    var isPlaying by remember { mutableStateOf(true) }
    var progress by remember { mutableFloatStateOf(0f) }

    // Auto-advance: riempie l'indicatore della slide corrente, poi passa alla
    // successiva. Si riavvia (e azzera il fill) a ogni cambio pagina o
    // play/pausa.
    LaunchedEffect(pagerState.settledPage, isPlaying, items.size) {
        if (items.size > 1 && isPlaying) {
            progress = 0f
            var start = -1L
            while (progress < 1f) {
                withFrameMillis { now ->
                    if (start < 0) start = now
                    progress = ((now - start) / SLIDE_INTERVAL_MS).coerceIn(0f, 1f)
                }
            }
            pagerState.animateScrollToPage((pagerState.currentPage + 1) % items.size)
        }
    }

    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val heroHeight = min(maxWidth * 1.25f, 560.dp)

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(heroHeight)
        ) {
            HorizontalPager(
                state = pagerState,
                modifier = Modifier.fillMaxSize()
            ) { page ->
                val item = items[page]
                HeroPage(
                    item = item,
                    isInWatchlist = isInWatchlist(item),
                    onPlay = { onPlay(item) },
                    onToggleWatchlist = { onToggleWatchlist(item) },
                    onOpen = { onOpen(item) }
                )
            }

            if (items.size > 1) {
                HeroControls(
                    pageCount = items.size,
                    currentPage = pagerState.currentPage,
                    progress = progress,
                    isPlaying = isPlaying,
                    onPageSelected = { index ->
                        scope.launch { pagerState.animateScrollToPage(index) }
                    },
                    onTogglePlay = { isPlaying = !isPlaying },
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp)
                        .padding(bottom = 16.dp)
                )
            }
        }
    }
}

@Composable
private fun HeroPage(
    item: TmdbItem,
    isInWatchlist: Boolean,
    onPlay: () -> Unit,
    onToggleWatchlist: () -> Unit,
    onOpen: () -> Unit
) {
    val pageBackground = MaterialTheme.colorScheme.background
    val categoryLabel = if (item.mediaType == "tv") "Serie di tendenza" else "Film di tendenza"

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF1E1E1E))
            .clickable(onClick = onOpen)
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            AsyncImage(
                model = TMDBImage.url(
                    path = item.backdropPath ?: item.posterPath,
                    size = TMDBImage.Size.W1280
                ),
                contentDescription = item.displayTitle,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )

            // L'artwork si dissolve nel background della pagina, senza banda nera
            // dura tra hero e righe sottostanti (come iOS).
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            0f to Color.Transparent,
                            0.5f to Color.Transparent,
                            1f to pageBackground
                        )
                    )
            )
        }

        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                // Spazio per gli indicatori sotto la caption.
                .padding(bottom = 44.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(
                text = categoryLabel,
                style = MaterialTheme.typography.labelLarge.copy(
                    shadow = Shadow(Color.Black.copy(alpha = 0.5f), blurRadius = 6f)
                ),
                color = Color.White.copy(alpha = 0.85f)
            )

            Text(
                text = item.displayTitle,
                style = MaterialTheme.typography.headlineMedium.copy(
                    fontSize = 30.sp,
                    fontWeight = FontWeight.ExtraBold,
                    shadow = Shadow(Color.Black.copy(alpha = 0.6f), blurRadius = 12f)
                ),
                color = Color.White,
                textAlign = TextAlign.Center,
                maxLines = 2
            )

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                BrandButton(onClick = onPlay) {
                    Icon(
                        imageVector = Icons.Filled.PlayArrow,
                        contentDescription = null
                    )
                    Text(
                        text = "Guarda",
                        style = MaterialTheme.typography.titleSmall,
                        modifier = Modifier.padding(start = 6.dp)
                    )
                }

                BrandIconButton(
                    onClick = onToggleWatchlist,
                    icon = if (isInWatchlist) {
                        Icons.Filled.Bookmark
                    } else {
                        Icons.Outlined.BookmarkBorder
                    },
                    contentDescription = if (isInWatchlist) {
                        "Rimuovi dalla watchlist"
                    } else {
                        "Aggiungi alla watchlist"
                    },
                    active = isInWatchlist
                )
            }
        }
    }
}

/**
 * Indicatori "story-style" centrati: capsule che si allargano quando attive,
 * con riempimento primary che avanza col timer; play/pausa al bordo destro.
 */
@Composable
private fun HeroControls(
    pageCount: Int,
    currentPage: Int,
    progress: Float,
    isPlaying: Boolean,
    onPageSelected: (Int) -> Unit,
    onTogglePlay: () -> Unit,
    modifier: Modifier = Modifier
) {
    Box(modifier = modifier) {
        Row(
            modifier = Modifier.align(Alignment.Center),
            horizontalArrangement = Arrangement.spacedBy(7.dp)
        ) {
            repeat(pageCount) { index ->
                val selected = index == currentPage
                val width by animateDpAsState(
                    targetValue = if (selected) 22.dp else 7.dp,
                    label = "indicatorWidth"
                )
                Box(
                    modifier = Modifier
                        .width(width)
                        .height(7.dp)
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = if (selected) 0.3f else 0.45f))
                        .clickable { onPageSelected(index) }
                ) {
                    if (selected) {
                        // Cresce dalla dimensione del cap (7) al pieno (22):
                        // parte come punto arrotondato, mai sliver verticale.
                        Box(
                            modifier = Modifier
                                .align(Alignment.CenterStart)
                                .width(7.dp + 15.dp * progress)
                                .height(7.dp)
                                .clip(CircleShape)
                                .background(MaterialTheme.colorScheme.primary)
                        )
                    }
                }
            }
        }

        Box(
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .size(24.dp)
                .clip(CircleShape)
                .background(Color.Black.copy(alpha = 0.4f))
                .clickable(onClick = onTogglePlay),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = if (isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                contentDescription = if (isPlaying) "Metti in pausa il carosello" else "Riprendi il carosello",
                tint = Color.White,
                modifier = Modifier.size(14.dp)
            )
        }
    }
}
