package com.streamo.app.ui.tv.anime

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage
import com.streamo.app.navigation.LocalNavController
import com.streamo.app.navigation.NavRoutes
import com.streamo.app.ui.anime.AnimeDetailViewModel
import com.streamo.app.ui.common.AmbientBackground
import com.streamo.app.ui.tv.common.TvFocusable
import com.streamo.app.util.TVLogic

/**
 * TV dettaglio anime: header + selettore finestre + griglia episodi D-pad.
 * Riutilizza [AnimeDetailViewModel]. Tap episodio (DPAD_CENTER) → Player.
 */
@Composable
fun TvAnimeDetailScreen(
    onBack: () -> Unit,
    viewModel: AnimeDetailViewModel = hiltViewModel()
) {
    val progressMap by viewModel.progressByEpisode.collectAsState()
    val navController = LocalNavController.current
    val gridState = rememberLazyGridState()
    val firstEpisodeFocus = remember { FocusRequester() }

    LaunchedEffect(Unit) { viewModel.load() }
    // Quando la prima finestra di episodi è pronta, sposta il focus lì (D-pad).
    LaunchedEffect(viewModel.episodes.firstOrNull()?.id) {
        if (viewModel.episodes.isNotEmpty()) runCatching { firstEpisodeFocus.requestFocus() }
    }

    AmbientBackground()

    Box(modifier = Modifier.fillMaxSize()) {
        LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 70.dp),
                state = gridState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(
                    start = 48.dp, end = 48.dp, bottom = 32.dp
                ),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // Header (poster + meta) — span pieno.
                item(span = { GridItemSpan(maxLineSpan) }) {
                    AnimeDetailHeader(
                        title = viewModel.title ?: "Anime ${viewModel.animeId}",
                        poster = viewModel.poster,
                        episodeCount = viewModel.totalEpisodes,
                        type = viewModel.type,
                        year = viewModel.year,
                        status = viewModel.status,
                        isDubbed = viewModel.isDubbed,
                        plot = viewModel.plot,
                        onBack = onBack
                    )
                }

                if (viewModel.errorMessage != null && viewModel.episodes.isEmpty()) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Box(modifier = Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                            Text(
                                "Episodi non disponibili",
                                color = Color.White,
                                style = MaterialTheme.typography.titleMedium
                            )
                        }
                    }
                    return@LazyVerticalGrid
                }

                // Selettore finestre (solo se più di 120 episodi).
                if (viewModel.windows.isNotEmpty()) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            viewModel.windows.forEach { range ->
                                TvWindowChip(
                                    label = "${range.first} - ${range.last}",
                                    selected = range == viewModel.selectedWindow,
                                    onClick = { viewModel.selectWindow(range) }
                                )
                            }
                        }
                    }
                }

                if (viewModel.isLoading && viewModel.episodes.isEmpty()) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Box(modifier = Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator()
                        }
                    }
                } else {
                    items(viewModel.episodes, key = { it.id }) { ep ->
                        // Coordinata `episode` = ep.id (univoco/stabile): il numero intero
                        // collide sugli speciali frazionari ("12.5" → null → 0).
                        val progress = progressMap[ep.id]
                        val pct = if (progress != null && progress.durationSeconds > 0) {
                            (progress.positionSeconds / progress.durationSeconds).toFloat().coerceIn(0f, 1f)
                        } else 0f
                        val watched = progress != null && progress.durationSeconds > 0 &&
                            progress.positionSeconds >= progress.durationSeconds * TVLogic.WATCHED_THRESHOLD
                        val isFirst = viewModel.episodes.indexOfFirst { it.id == ep.id } == 0
                        TvEpisodeCell(
                            label = ep.number ?: "•",
                            watched = watched,
                            inProgress = pct > 0f && !watched,
                            progress = pct,
                            focusRequester = if (isFirst) firstEpisodeFocus else null,
                            onClick = {
                                navController.navigate(
                                    NavRoutes.Player(
                                        tmdbId = viewModel.animeId,
                                        mediaType = "anime",
                                        resumeSeason = 1,
                                        resumeEpisode = ep.id,
                                        title = viewModel.title ?: "",
                                        poster = viewModel.poster,
                                        releaseDate = null,
                                        animeEpisodeId = ep.id,
                                        animeSlug = viewModel.slug
                                    )
                                )
                            }
                        )
                    }
                }
            }
        }
    }

@Composable
private fun AnimeDetailHeader(
    title: String,
    poster: String?,
    episodeCount: Int,
    type: String?,
    year: Int,
    status: String?,
    isDubbed: Boolean,
    plot: String?,
    onBack: () -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(20.dp),
        verticalAlignment = Alignment.Top
    ) {
        Box(
            modifier = Modifier
                .width(120.dp)
                .aspectRatio(2f / 3f)
                .clip(RoundedCornerShape(10.dp))
                .background(Color(0xFF1E1E1E))
        ) {
            if (poster != null) {
                AsyncImage(
                    model = poster,
                    contentDescription = title,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize()
                )
            }
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                text = title,
                color = Color.White,
                fontWeight = FontWeight.Bold,
                fontSize = 26.sp,
                maxLines = 3
            )
            val meta = listOfNotNull(
                type?.takeIf { it.isNotBlank() },
                year.takeIf { it > 0 }?.toString(),
                status?.takeIf { it.isNotBlank() }
            ).joinToString(" · ")
            if (meta.isNotEmpty()) {
                Text(
                    text = meta,
                    color = Color.White.copy(alpha = 0.6f),
                    fontSize = 15.sp
                )
            }
            if (episodeCount > 0) {
                Text(
                    text = "$episodeCount episodi",
                    color = Color.White.copy(alpha = 0.6f),
                    fontSize = 15.sp
                )
            }
            if (isDubbed) {
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color.Black.copy(alpha = 0.55f))
                        .padding(horizontal = 8.dp, vertical = 3.dp)
                ) {
                    Text("ITA", color = Color.White, style = MaterialTheme.typography.labelSmall)
                }
            }
            if (!plot.isNullOrBlank()) {
                Text(
                    text = plot,
                    color = Color.White.copy(alpha = 0.72f),
                    fontSize = 14.sp,
                    maxLines = 4
                )
            }
        }
        // Bottone indietro D-pad.
        TvFocusable(onClick = onBack, scaleOnFocus = 1.05f) { focused ->
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(if (focused) Color.White.copy(alpha = 0.18f) else Color.White.copy(alpha = 0.08f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Filled.ArrowBack, contentDescription = "Indietro", tint = Color.White)
            }
        }
    }
}

@Composable
private fun TvWindowChip(label: String, selected: Boolean, onClick: () -> Unit) {
    TvFocusable(onClick = onClick) { focused ->
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(50))
                .background(
                    when {
                        selected -> MaterialTheme.colorScheme.primary
                        focused -> Color.White.copy(alpha = 0.18f)
                        else -> Color.White.copy(alpha = 0.08f)
                    }
                )
                .padding(horizontal = 16.dp, vertical = 8.dp)
        ) {
            Text(
                text = label,
                color = if (selected) MaterialTheme.colorScheme.onPrimary else Color.White,
                style = MaterialTheme.typography.labelLarge
            )
        }
    }
}

@Composable
private fun TvEpisodeCell(
    label: String,
    watched: Boolean,
    inProgress: Boolean,
    progress: Float,
    focusRequester: FocusRequester?,
    onClick: () -> Unit
) {
    TvFocusable(
        onClick = onClick,
        focusRequester = focusRequester,
        scaleOnFocus = 1.06f
    ) { focused ->
        Box(
            modifier = Modifier
                .aspectRatio(1f)
                .clip(RoundedCornerShape(8.dp))
                .background(
                    when {
                        focused -> Color.White.copy(alpha = 0.24f)
                        watched -> Color.White.copy(alpha = 0.08f)
                        else -> Color.White.copy(alpha = 0.16f)
                    }
                ),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = label,
                color = Color.White,
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium
            )
            if (watched) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(4.dp)
                        .size(16.dp)
                        .clip(CircleShape)
                        .background(Color.Black.copy(alpha = 0.55f)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Filled.Check, contentDescription = "Visto", tint = Color.White, modifier = Modifier.size(12.dp))
                }
            } else if (inProgress) {
                LinearProgressIndicator(
                    progress = { progress.coerceAtLeast(0.04f) },
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .fillMaxWidth()
                        .height(3.dp),
                    color = MaterialTheme.colorScheme.primary,
                    trackColor = Color.Transparent
                )
            }
        }
    }
}