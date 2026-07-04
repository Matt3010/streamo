package com.streamo.app.ui.anime

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage
import com.streamo.app.navigation.LocalBottomBarPadding
import com.streamo.app.navigation.LocalNavController
import com.streamo.app.navigation.NavRoutes
import com.streamo.app.provider.anime.AUEpisode
import com.streamo.app.ui.common.BrandButton
import com.streamo.app.ui.common.GlassFilterChip
import com.streamo.app.ui.theme.AppShapes
import com.streamo.app.util.TVLogic

@Composable
fun AnimeDetailScreen(
    onBack: () -> Unit,
    viewModel: AnimeDetailViewModel = hiltViewModel()
) {
    val progressMap by viewModel.progressByEpisode.collectAsState()
    val navController = LocalNavController.current

    LaunchedEffect(Unit) { viewModel.load() }

    Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
        com.streamo.app.ui.common.GlassTopBarScaffold(
            onLeading = onBack
        ) { topPadding ->
            if (viewModel.errorMessage != null && viewModel.episodes.isEmpty()) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(top = topPadding)
                        .padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Text(
                        "Episodi non disponibili",
                        color = Color.White,
                        style = MaterialTheme.typography.headlineSmall
                    )
                    Text(
                        viewModel.errorMessage!!,
                        color = Color.White.copy(alpha = 0.6f),
                        textAlign = TextAlign.Center
                    )
                    BrandButton(onClick = { viewModel.load() }) { Text("Riprova") }
                }
                return@GlassTopBarScaffold
            }

            val gridState = rememberLazyGridState()
            LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 56.dp),
                state = gridState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(
                    start = 16.dp, top = topPadding, end = 16.dp,
                    bottom = 32.dp + LocalBottomBarPadding.current
                ),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                // Header (poster + meta) — span pieno.
                item(span = { GridItemSpan(maxLineSpan) }) {
                    AnimeHeader(
                        title = viewModel.title ?: "Anime ${viewModel.animeId}",
                        poster = viewModel.poster,
                        episodeCount = viewModel.totalEpisodes,
                        type = viewModel.type,
                        year = viewModel.year,
                        status = viewModel.status,
                        isDubbed = viewModel.isDubbed
                    )
                }

                // Sinossi espandibile — span pieno (solo se presente).
                if (!viewModel.plot.isNullOrBlank()) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        AnimeSynopsis(plot = viewModel.plot!!)
                    }
                }

                // Selettore finestre (solo se più di 120 episodi). GlassFilterChip + FlowRow:
                // il FilterChip Material3 raw riserva slot icona leading → badge fantasma
                // che si allungava sotto l'ultimo chip. GlassFilterChip è coerente col resto.
                if (viewModel.windows.isNotEmpty()) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        FlowRow(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 8.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            viewModel.windows.forEach { range ->
                                GlassFilterChip(
                                    label = "${range.first} - ${range.last}",
                                    selected = range == viewModel.selectedWindow,
                                    onClick = { viewModel.selectWindow(range) }
                                )
                            }
                        }
                    }
                }

                if (viewModel.isLoading && viewModel.episodes.isEmpty()) {
                    items(12) {
                        Box(
                            modifier = Modifier
                                .aspectRatio(1f)
                                .clip(AppShapes.sm)
                                .background(Color.White.copy(alpha = 0.08f))
                        )
                    }
                } else {
                    items(viewModel.episodes, key = { it.id }) { ep ->
                        // Coordinata `episode` = ep.id (id AnimeUnity, univoco e stabile):
                        // il numero intero collide sugli speciali frazionari ("12.5" → null → 0).
                        val progress = progressMap[ep.id]
                        val pct = if (progress != null && progress.durationSeconds > 0) {
                            (progress.positionSeconds / progress.durationSeconds).toFloat().coerceIn(0f, 1f)
                        } else 0f
                        val watched = progress != null && progress.durationSeconds > 0 &&
                            progress.positionSeconds >= progress.durationSeconds * TVLogic.WATCHED_THRESHOLD
                        EpisodeCell(
                            label = ep.number ?: "•",
                            watched = watched,
                            inProgress = pct > 0f && !watched,
                            progress = pct,
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
}

@Composable
private fun AnimeHeader(
    title: String,
    poster: String?,
    episodeCount: Int,
    type: String?,
    year: Int,
    status: String?,
    isDubbed: Boolean
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Box(
            modifier = Modifier
                .width(120.dp)
                .aspectRatio(2f / 3f)
                .clip(AppShapes.md)
                .background(Color.White.copy(alpha = 0.08f))
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
        Column(
            modifier = Modifier.padding(top = 4.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Text(
                text = title,
                color = Color.White,
                fontWeight = FontWeight.Bold,
                fontSize = 22.sp,
                maxLines = 3
            )
            // Riga metadati: tipo · anno · stato (solo i pezzi disponibili).
            val meta = listOfNotNull(
                type?.takeIf { it.isNotBlank() },
                year.takeIf { it > 0 }?.toString(),
                status?.takeIf { it.isNotBlank() }
            ).joinToString(" · ")
            if (meta.isNotEmpty()) {
                Text(
                    text = meta,
                    color = Color.White.copy(alpha = 0.6f),
                    fontSize = 14.sp
                )
            }
            if (episodeCount > 0) {
                Text(
                    text = "$episodeCount episodi",
                    color = Color.White.copy(alpha = 0.6f),
                    fontSize = 14.sp
                )
            }
            if (isDubbed) {
                Box(
                    modifier = Modifier
                        .clip(AppShapes.xs)
                        .background(Color.Black.copy(alpha = 0.55f))
                        .padding(horizontal = 8.dp, vertical = 3.dp)
                ) {
                    Text(
                        text = "ITA",
                        color = Color.White,
                        style = MaterialTheme.typography.labelSmall
                    )
                }
            }
        }
    }
}

@Composable
private fun AnimeSynopsis(plot: String) {
    var expanded by remember { mutableStateOf(false) }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text(
            text = plot,
            color = Color.White.copy(alpha = 0.78f),
            fontSize = 14.sp,
            maxLines = if (expanded) Int.MAX_VALUE else 4
        )
        Text(
            text = if (expanded) "Mostra meno" else "Mostra tutto",
            color = MaterialTheme.colorScheme.primary,
            fontSize = 14.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.clickable { expanded = !expanded }
        )
    }
}

@Composable
private fun EpisodeCell(
    label: String,
    watched: Boolean,
    inProgress: Boolean,
    progress: Float,
    onClick: () -> Unit
) {
    Box(
        modifier = Modifier
            .aspectRatio(1f)
            .clip(AppShapes.sm)
            .background(
                if (watched) Color.White.copy(alpha = 0.08f)
                else Color.White.copy(alpha = 0.18f)
            )
            .clickable(onClick = onClick)
    ) {
        Text(
            text = label,
            color = Color.White,
            fontSize = 14.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.align(Alignment.Center)
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
                Icon(
                    imageVector = Icons.Filled.Check,
                    contentDescription = "Visto",
                    tint = Color.White,
                    modifier = Modifier.size(12.dp)
                )
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