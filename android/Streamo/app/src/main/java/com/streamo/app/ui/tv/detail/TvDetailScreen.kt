package com.streamo.app.ui.tv.detail

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.BookmarkBorder
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.Replay
import androidx.compose.material.icons.filled.ThumbUp
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
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.media3.common.util.UnstableApi
import coil.compose.AsyncImage
import kotlinx.coroutines.delay
import com.streamo.app.data.remote.dto.TmdbEpisodeDetail
import com.streamo.app.tmdb.TMDBImage
import com.streamo.app.ui.common.AmbientBackground
import com.streamo.app.ui.common.ImagePlaceholder
import com.streamo.app.ui.detail.DetailViewModel
import com.streamo.app.ui.detail.ProviderAvailability
import com.streamo.app.ui.tv.common.TvFocusable
import com.streamo.app.ui.tv.common.tvFocusFrame
import com.streamo.app.ui.tv.common.TvMediaCard
import com.streamo.app.ui.tv.common.TvSectionTitle
import com.streamo.app.util.TVLogic

/**
 * TV Detail screen. Full-bleed backdrop hero; large focusable Play / Watchlist
 * buttons (Play takes initial focus); focusable season chips + episode rail;
 * recommendations. Provider picker is a focusable overlay (not an AlertDialog).
 */
@OptIn(UnstableApi::class)
@Composable
fun TvDetailScreen(
    onBack: () -> Unit = {},
    onNavigateToDetail: (Int, String, Int, Int) -> Unit = { _, _, _, _ -> },
    onNavigateToPlayer: (Int, String, Int, Int, String, String?, String?) -> Unit = { _, _, _, _, _, _, _ -> },
    viewModel: DetailViewModel = hiltViewModel()
) {
    val isInWatchlist by viewModel.isInWatchlist.collectAsState()
    val playFocusRequester = remember { FocusRequester() }
    val playInteraction = remember { MutableInteractionSource() }
    val playFocused by playInteraction.collectIsFocusedAsState()
    val watchlistFocusRequester = remember { FocusRequester() }
    val watchlistInteraction = remember { MutableInteractionSource() }
    val watchlistFocused by watchlistInteraction.collectIsFocusedAsState()
    val loadingFocusRequester = remember { FocusRequester() }

    LaunchedEffect(Unit) { viewModel.load() }

    // Hold focus on the loading anchor for the WHOLE load. For a series the spinner stays
    // up for seconds (loadSeason/resolveProvider); without a focusable target in the content
    // the nav rail grabs focus and auto-expands. A fixed retry count expires mid-load and
    // the rail grabs the gap, so reclaim every frame until loading ends or Play has focus.
    LaunchedEffect(viewModel.isLoading) {
        while ((viewModel.isLoading || viewModel.item == null) && !playFocused) {
            runCatching { loadingFocusRequester.requestFocus() }
            delay(80)
        }
    }

    // Drive initial focus onto Play. Key on the moment the content (and thus Play's
    // modifier) is actually rendered — i.e. loading finished AND item present — NOT on
    // `item` alone: for a series `item` is set early while the spinner is still up
    // (loadSeason/resolveProvider keep isLoading true for seconds), so a retry keyed on
    // `item` expires before Play exists, leaving the nav rail to grab focus and pop open.
    // During the NavHost swap the rail can still momentarily grab focus, so retry a few
    // frames — but stop the instant Play has focus, so a quick D-pad move isn't yanked back.
    // Play is DISABLED when no provider is available ("Titolo non disponibile") — a disabled
    // node can't take focus, so requesting it leaves focus orphaned and the rail grabs it.
    // Fall back to the always-enabled Watchlist button in that case.
    val playEnabled = viewModel.providerAvailability == ProviderAvailability.READY ||
        viewModel.providerAvailability == ProviderAvailability.NEEDS_PICKER
    val contentReady = !viewModel.isLoading && viewModel.item != null
    LaunchedEffect(contentReady, playEnabled) {
        if (contentReady) {
            // Initial delay to let Compose settle the layout after content appears
            delay(100)
            repeat(15) {
                if (playFocused || watchlistFocused) return@LaunchedEffect
                val target = if (playEnabled) playFocusRequester else watchlistFocusRequester
                runCatching { target.requestFocus() }
                delay(60)
            }
        }
    }

    BackHandler(enabled = !viewModel.showProviderPicker) { onBack() }

    Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
        AmbientBackground()

        if (viewModel.isLoading || viewModel.item == null) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .focusRequester(loadingFocusRequester)
                    .focusable(),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(color = Color.White)
            }
            return@Box
        }

        val detail = viewModel.item!!
        val backdrop = (detail.backdropPath?.takeIf { it.isNotBlank() }
            ?: detail.posterPath?.takeIf { it.isNotBlank() })

        // Backdrop hero
        if (backdrop != null) {
            AsyncImage(
                model = TMDBImage.url(backdrop, TMDBImage.Size.W1280),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxWidth().height(560.dp)
            )
        }
        // Scrim: dark left (for text) + dark bottom (blend into list)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(560.dp)
                .background(
                    Brush.horizontalGradient(
                        colors = listOf(Color.Black.copy(alpha = 0.85f), Color.Transparent),
                        endX = 1400f
                    )
                )
        )
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(560.dp)
                .background(
                    Brush.verticalGradient(
                        colors = listOf(Color.Transparent, Color.Transparent, Color.Black)
                    )
                )
        )

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 48.dp, end = 48.dp, top = 56.dp, bottom = 48.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Push hero content down over the lower third of the backdrop.
            item { Spacer(modifier = Modifier.height(140.dp)) }

            // Title
            item {
                Text(
                    text = detail.displayTitle,
                    style = MaterialTheme.typography.displaySmall,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.fillMaxWidth(0.7f)
                )
            }

            // Meta + genres
            item {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    if (viewModel.metaLine.isNotBlank()) {
                        Text(
                            text = viewModel.metaLine,
                            style = MaterialTheme.typography.bodyLarge,
                            color = Color.White.copy(alpha = 0.85f)
                        )
                    }
                    if (viewModel.genresLine.isNotBlank()) {
                        Text(
                            text = viewModel.genresLine,
                            style = MaterialTheme.typography.bodyMedium,
                            color = Color.White.copy(alpha = 0.6f)
                        )
                    }
                }
            }

            // Actions: Play + Watchlist
            item {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.focusGroup()
                ) {
                    val playEnabled = viewModel.providerAvailability == ProviderAvailability.READY ||
                        viewModel.providerAvailability == ProviderAvailability.NEEDS_PICKER
                    TvFocusable(
                        onClick = {
                            when (viewModel.providerAvailability) {
                                ProviderAvailability.NEEDS_PICKER -> viewModel.showProviderPicker = true
                                ProviderAvailability.READY -> {
                                    val (s, e) = if (viewModel.isTV) {
                                        viewModel.resumeSeasonEpisode
                                            ?: Pair(viewModel.seasons.firstOrNull() ?: 1, 1)
                                    } else Pair(0, 0)
                                    onNavigateToPlayer(
                                        viewModel.tmdbId, viewModel.mediaType, s, e,
                                        detail.displayTitle, detail.posterPath, detail.releaseDate
                                    )
                                }
                                else -> {}
                            }
                        },
                        enabled = playEnabled,
                        focusRequester = playFocusRequester,
                        interactionSource = playInteraction,
                        scaleOnFocus = 1.05f
                    ) { focused ->
                        Row(
                            modifier = Modifier
                                .clip(RoundedCornerShape(10.dp))
                                .background(
                                    if (focused) Color.White
                                    else MaterialTheme.colorScheme.primary
                                )
                                .padding(horizontal = 28.dp, vertical = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Icon(
                                Icons.Filled.PlayArrow,
                                contentDescription = null,
                                tint = if (focused) Color.Black
                                else MaterialTheme.colorScheme.onPrimary
                            )
                            Text(
                                viewModel.playLabel,
                                color = if (focused) Color.Black
                                else MaterialTheme.colorScheme.onPrimary,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                    }

                    TvFocusable(
                        onClick = { viewModel.toggleWatchlist() },
                        focusRequester = watchlistFocusRequester,
                        interactionSource = watchlistInteraction,
                        scaleOnFocus = 1.05f
                    ) { focused ->
                        Row(
                            modifier = Modifier
                                .clip(RoundedCornerShape(10.dp))
                                .background(
                                    if (focused) Color.White.copy(alpha = 0.95f)
                                    else Color.White.copy(alpha = 0.12f)
                                )
                                .padding(horizontal = 20.dp, vertical = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Icon(
                                imageVector = if (isInWatchlist) Icons.Filled.Bookmark else Icons.Filled.BookmarkBorder,
                                contentDescription = if (isInWatchlist) "Rimuovi dalla lista" else "Aggiungi alla lista",
                                tint = if (focused) Color.Black else Color.White
                            )
                            Text(
                                text = if (isInWatchlist) "Nella lista" else "La mia lista",
                                color = if (focused) Color.Black else Color.White
                            )
                        }
                    }
                }
            }

            // Overview
            item {
                Text(
                    text = detail.overview?.takeIf { it.isNotBlank() } ?: "Descrizione non disponibile",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color.White.copy(alpha = 0.85f),
                    maxLines = 4,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.fillMaxWidth(0.6f)
                )
            }

            // Cast
            if (viewModel.castLine.isNotBlank()) {
                item {
                    Text(
                        text = "Cast: ${viewModel.castLine}",
                        style = MaterialTheme.typography.bodySmall,
                        color = Color.White.copy(alpha = 0.6f),
                        modifier = Modifier.fillMaxWidth(0.6f)
                    )
                }
            }

            // Seasons + episodes (TV)
            if (viewModel.isTV && viewModel.seasons.isNotEmpty()) {
                item {
                    TvSectionTitle(
                        title = "Episodi",
                        icon = Icons.Filled.PlayCircle,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }
                // Season chips
                if (viewModel.seasons.size > 1) {
                    item {
                        LazyRow(
                            modifier = Modifier.fillMaxWidth().focusGroup().focusRestorer(),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                        ) {
                            items(viewModel.seasons) { season ->
                                val selected = season == viewModel.selectedSeason
                                TvFocusable(
                                    onClick = { viewModel.changeSeason(season) },
                                    scaleOnFocus = 1.05f
                                ) { focused ->
                                    Box(
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(8.dp))
                                            .background(
                                                when {
                                                    focused -> Color.White
                                                    selected -> MaterialTheme.colorScheme.primary
                                                    else -> Color.White.copy(alpha = 0.12f)
                                                }
                                            )
                                            .padding(horizontal = 16.dp, vertical = 8.dp)
                                    ) {
                                        Text(
                                            text = "Stagione $season",
                                            style = MaterialTheme.typography.labelLarge,
                                            color = when {
                                                focused -> Color.Black
                                                selected -> MaterialTheme.colorScheme.onPrimary
                                                else -> Color.White
                                            }
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
                // Episode rail
                item {
                    if (viewModel.loadingEpisodes) {
                        Box(
                            modifier = Modifier.fillMaxWidth().height(200.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            CircularProgressIndicator(color = Color.White)
                        }
                    } else if (viewModel.episodes.isEmpty()) {
                        Text(
                            text = "Nessun episodio disponibile per questa stagione.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = Color.White.copy(alpha = 0.6f)
                        )
                    } else {
                        LazyRow(
                            modifier = Modifier.fillMaxWidth().focusGroup().focusRestorer(),
                            horizontalArrangement = Arrangement.spacedBy(16.dp),
                            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp)
                        ) {
                            items(viewModel.episodes) { ep ->
                                val progress = viewModel.episodeProgresses[
                                    Pair(ep.seasonNumber ?: viewModel.selectedSeason, ep.episodeNumber)
                                ]
                                TvEpisodeCard(
                                    episode = ep,
                                    positionSeconds = progress?.positionSeconds ?: 0.0,
                                    durationSeconds = progress?.durationSeconds ?: 0.0,
                                    onClick = {
                                        onNavigateToPlayer(
                                            viewModel.tmdbId, viewModel.mediaType,
                                            ep.seasonNumber ?: viewModel.selectedSeason, ep.episodeNumber,
                                            detail.displayTitle, detail.posterPath, detail.releaseDate
                                        )
                                    }
                                )
                            }
                        }
                    }
                }
            }

            // Recommendations
            if (viewModel.recommendations.isNotEmpty()) {
                item {
                    TvSectionTitle(
                        title = "Ti potrebbe piacere",
                        icon = Icons.Filled.ThumbUp,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }
                item {
                    LazyRow(
                        modifier = Modifier.fillMaxWidth().focusGroup().focusRestorer(),
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp)
                    ) {
                        items(viewModel.recommendations) { rec ->
                            TvMediaCard(
                                title = rec.displayTitle,
                                posterUrl = TMDBImage.url(rec.posterPath, TMDBImage.Size.W500),
                                onClick = {
                                    onNavigateToDetail(rec.id, rec.mediaType ?: "movie", 0, 0)
                                }
                            )
                        }
                    }
                }
            }
        }

        // Provider picker overlay (focusable)
        if (viewModel.showProviderPicker && viewModel.providerCandidates.isNotEmpty()) {
            TvProviderPicker(
                viewModel = viewModel,
                onDismiss = { viewModel.showProviderPicker = false }
            )
        }
    }
}

@Composable
private fun TvEpisodeCard(
    episode: TmdbEpisodeDetail,
    positionSeconds: Double,
    durationSeconds: Double,
    onClick: () -> Unit
) {
    val watched = durationSeconds > 0 && positionSeconds >= durationSeconds * TVLogic.WATCHED_THRESHOLD
    val pct = when {
        watched -> 1f
        durationSeconds > 0 -> (positionSeconds / durationSeconds).toFloat().coerceIn(0f, 1f)
        else -> 0f
    }

    // No scaleOnFocus: a focus scale grows the (tall) card's mapped bounds, which makes
    // the parent LazyColumn micro-scroll vertically on every horizontal focus move — the
    // annoying up/down jitter. The focus frame + play icon + brightened title are enough.
    TvFocusable(onClick = onClick, modifier = Modifier.width(260.dp)) { focused ->
        Column {
            Box(modifier = Modifier.fillMaxWidth().tvFocusFrame(focused)) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(16f / 9f)
                        .clip(RoundedCornerShape(9.dp))
                        .background(Color(0xFF1E1E1E)),
                    contentAlignment = Alignment.Center
                ) {
                    val still = episode.stillPath?.takeIf { it.isNotBlank() }
                    if (still != null) {
                        AsyncImage(
                            model = TMDBImage.url(still, TMDBImage.Size.W300),
                            contentDescription = null,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize()
                        )
                    } else {
                        ImagePlaceholder(label = "Episodio ${episode.episodeNumber}", iconSizeDp = 32.dp)
                    }
                    Box(
                        modifier = Modifier
                            .matchParentSize()
                            .background(
                                Brush.verticalGradient(
                                    colors = listOf(Color.Transparent, Color.Black.copy(alpha = 0.75f))
                                )
                            )
                    )
                    // Episode number bottom-left (no background, pure white text like mobile)
                    Text(
                        text = "${episode.episodeNumber}",
                        style = MaterialTheme.typography.titleMedium,
                        color = Color.White,
                        modifier = Modifier
                            .align(Alignment.BottomStart)
                            .padding(8.dp)
                    )
                    // Watched / timestamp bottom-right
                    val statusText = when {
                        watched -> "Visto"
                        positionSeconds > 0 && durationSeconds > 0 ->
                            "${formatClock(positionSeconds)} / ${formatClock(durationSeconds)}"
                        else -> null
                    }
                    if (statusText != null) {
                        Text(
                            text = statusText,
                            style = MaterialTheme.typography.labelSmall,
                            color = Color.White.copy(alpha = 0.9f),
                            modifier = Modifier
                                .align(Alignment.BottomEnd)
                                .padding(8.dp)
                        )
                    }
                    if (focused) {
                        Icon(
                            imageVector = if (watched) Icons.Filled.Replay else Icons.Filled.PlayArrow,
                            contentDescription = null,
                            tint = Color.White,
                            modifier = Modifier.size(44.dp)
                        )
                    }
                    if (pct > 0f) {
                        LinearProgressIndicator(
                            progress = { pct.coerceAtLeast(0.04f) },
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
            Text(
                text = episode.name?.takeIf { it.isNotBlank() } ?: "Episodio ${episode.episodeNumber}",
                style = MaterialTheme.typography.labelMedium,
                color = if (focused) Color.White else Color.White.copy(alpha = 0.8f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.fillMaxWidth().padding(top = 6.dp)
            )
            Text(
                text = episode.overview?.takeIf { it.isNotBlank() } ?: "",
                style = MaterialTheme.typography.labelSmall,
                color = Color.White.copy(alpha = 0.55f),
                minLines = 2,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.fillMaxWidth().padding(top = 2.dp)
            )
        }
    }
}

/** Seconds → "M:SS" or "H:MM:SS". */
private fun formatClock(seconds: Double): String {
    val total = seconds.toInt().coerceAtLeast(0)
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

@Composable
private fun TvProviderPicker(
    viewModel: DetailViewModel,
    onDismiss: () -> Unit
) {
    val firstFocus = remember { FocusRequester() }
    BackHandler { onDismiss() }
    LaunchedEffect(Unit) { runCatching { firstFocus.requestFocus() } }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.7f)),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .widthIn(min = 400.dp, max = 600.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(Color(0xFF181818))
                .padding(24.dp)
                .focusGroup(),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                text = "Scegli la versione",
                style = MaterialTheme.typography.titleLarge,
                color = Color.White,
                modifier = Modifier.padding(bottom = 8.dp)
            )
            viewModel.providerCandidates.forEachIndexed { index, candidate ->
                TvFocusable(
                    onClick = { viewModel.confirmProviderCandidate(candidate) },
                    focusRequester = if (index == 0) firstFocus else null,
                    modifier = Modifier.fillMaxWidth()
                ) { focused ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(if (focused) Color.White.copy(alpha = 0.15f) else Color.Transparent)
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            Text(
                                text = candidate.title,
                                style = MaterialTheme.typography.bodyLarge,
                                color = Color.White
                            )
                            candidate.year?.let {
                                Text(
                                    text = it.toString(),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = Color.White.copy(alpha = 0.6f)
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
