package com.streamo.app.ui.detail

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.BookmarkBorder
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.Replay
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage
import com.streamo.app.navigation.LocalNavController
import com.streamo.app.navigation.NavRoutes
import com.streamo.app.ui.detail.ProviderAvailability
import com.streamo.app.data.remote.dto.TmdbEpisodeDetail
import com.streamo.app.data.remote.dto.TmdbItem
import com.streamo.app.data.remote.dto.TmdbReview
import com.streamo.app.tmdb.TMDBImage
import com.streamo.app.ui.common.MediaCard
import com.streamo.app.ui.common.SectionHeader
import com.streamo.app.ui.common.SkeletonCard
import com.streamo.app.util.TVLogic
import androidx.browser.customtabs.CustomTabsIntent
import android.net.Uri
import java.text.SimpleDateFormat
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DetailScreen(onBack: () -> Unit = {}) {
    val viewModel: DetailViewModel = hiltViewModel()
    LaunchedEffect(Unit) {
        viewModel.load()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        viewModel.item?.displayTitle ?: "Dettaglio",
                        style = MaterialTheme.typography.titleLarge,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Indietro"
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color.Transparent,
                    titleContentColor = MaterialTheme.colorScheme.onBackground
                )
            )
        }
    ) { paddingValues ->
        Box(modifier = Modifier.fillMaxSize()) {
            if (viewModel.isLoading) {
                DetailSkeleton(modifier = Modifier.padding(paddingValues))
            } else if (viewModel.loadError != null) {
                ErrorState(
                    message = viewModel.loadError!!,
                    onRetry = { viewModel.load() },
                    modifier = Modifier.padding(paddingValues)
                )
            } else {
                viewModel.item?.let { item ->
                    DetailContent(
                        item = item,
                        viewModel = viewModel,
                        modifier = Modifier.padding(paddingValues)
                    )
                }
            }
        }
    }
}

@Composable
private fun DetailContent(
    item: TmdbItem,
    viewModel: DetailViewModel,
    modifier: Modifier = Modifier
) {
    val scrollState = rememberScrollState()

    Box(modifier = modifier.fillMaxSize()) {
        // Backdrop
        AsyncImage(
            model = TMDBImage.url(item.backdropPath ?: item.posterPath, TMDBImage.Size.W1280),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .fillMaxWidth()
                .height(430.dp)
        )

        // Static darkening overlay so text is readable even on bright backdrops
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(430.dp)
                .background(
                    Brush.verticalGradient(
                        colors = listOf(
                            Color.Black.copy(alpha = 0.55f),
                            Color.Black.copy(alpha = 0.25f),
                            Color.Transparent
                        )
                    )
                )
        )

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(scrollState),
            verticalArrangement = Arrangement.spacedBy(0.dp)
        ) {
            // Scrolling overlay: gradient scrolls with content and covers the backdrop
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 430.dp)
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(
                                Color.Transparent,
                                Color.Transparent,
                                Color.Black.copy(alpha = 0.4f),
                                Color.Black.copy(alpha = 0.85f),
                                Color.Black
                            )
                        )
                    )
                    .padding(16.dp)
            ) {
                Column(
                    modifier = Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Box(modifier = Modifier.weight(1f))

                    Text(
                        text = item.displayTitle,
                        style = MaterialTheme.typography.headlineLarge,
                        color = MaterialTheme.colorScheme.onBackground
                    )

                    // Meta
                    if (viewModel.metaLine.isNotEmpty()) {
                        Text(
                            text = viewModel.metaLine,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    if (viewModel.genresLine.isNotEmpty()) {
                        Text(
                            text = viewModel.genresLine,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    if (viewModel.releaseStatusText.isNotEmpty()) {
                        Text(
                            text = viewModel.releaseStatusText,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onBackground
                        )
                    }

                    // Overview
                    item.overview?.takeIf { it.isNotBlank() }?.let {
                        Text(
                            text = it,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onBackground
                        )
                    }

                    val navController = LocalNavController.current
                    val isInWatchlist by viewModel.isInWatchlist.collectAsState()
                    val isReady = viewModel.providerAvailability == ProviderAvailability.READY
                    val needsPicker = viewModel.providerAvailability == ProviderAvailability.NEEDS_PICKER
                    val isResolving = viewModel.providerAvailability == ProviderAvailability.RESOLVING

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Button(
                            onClick = {
                                when {
                                    needsPicker -> viewModel.showProviderPicker = true
                                    isReady -> {
                                        val (s, e) = if (viewModel.isTV) {
                                            viewModel.resumeSeasonEpisode ?: Pair(viewModel.seasons.firstOrNull() ?: 1, 1)
                                        } else {
                                            Pair(0, 0)
                                        }
                                        navController.navigate(
                                            NavRoutes.Player(
                                                viewModel.tmdbId,
                                                viewModel.mediaType,
                                                s,
                                                e,
                                                item.title ?: item.name ?: "",
                                                item.posterPath,
                                                item.releaseDate
                                            )
                                        )
                                    }
                                }
                            },
                            enabled = isReady || needsPicker,
                            modifier = Modifier.weight(1f)
                        ) {
                            if (isResolving) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(18.dp),
                                    strokeWidth = 2.dp,
                                    color = MaterialTheme.colorScheme.onPrimary
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                            } else {
                                Icon(Icons.Filled.PlayCircle, contentDescription = null)
                                Spacer(modifier = Modifier.width(8.dp))
                            }
                            Text(viewModel.playLabel)
                        }
                        IconButton(
                            onClick = { viewModel.toggleWatchlist() }
                        ) {
                            Icon(
                                imageVector = if (isInWatchlist) Icons.Filled.Bookmark else Icons.Filled.BookmarkBorder,
                                contentDescription = if (isInWatchlist) "Rimuovi da lista" else "Aggiungi a lista",
                                tint = if (isInWatchlist) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        IconButton(
                            onClick = {
                                if (viewModel.isTV) {
                                    navController.navigate(
                                        NavRoutes.SeriesDownloads(
                                            viewModel.tmdbId,
                                            item.title ?: item.name ?: "",
                                            showAllEpisodes = true
                                        )
                                    )
                                } else {
                                    viewModel.enqueueDownload()
                                }
                            }
                        ) {
                            Icon(
                                imageVector = Icons.Filled.Download,
                                contentDescription = "Scarica",
                                tint = MaterialTheme.colorScheme.primary
                            )
                        }
                    }

                    if (viewModel.isTV && isReady && viewModel.nextAfterResumeEpisode != null) {
                        TextButton(
                            onClick = {
                                val next = viewModel.nextAfterResumeEpisode!!
                                navController.navigate(
                                    NavRoutes.Player(
                                        viewModel.tmdbId,
                                        viewModel.mediaType,
                                        next.first,
                                        next.second,
                                        item.title ?: item.name ?: "",
                                        item.posterPath,
                                        item.releaseDate
                                    )
                                )
                            },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("Vai al prossimo")
                        }
                    }

                    TextButton(
                        onClick = { viewModel.markWatched() },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Marca come visto")
                    }

                    // Cast
                    if (viewModel.castLine.isNotEmpty()) {
                        Text(
                            text = "Cast: ${viewModel.castLine}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }

                    // TV summary
                    if (viewModel.tvSummary.isNotEmpty()) {
                        Text(
                            text = viewModel.tvSummary,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }

                    // Trailer button
                    val context = LocalContext.current
                    viewModel.trailerUrl?.let { url ->
                        TextButton(
                            onClick = {
                                val intent = CustomTabsIntent.Builder().build()
                                intent.launchUrl(context, Uri.parse(url))
                            },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("Trailer")
                        }
                    }
                }
            }

            // Bottom sections on solid black
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color.Black)
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // Episodes (TV)
                if (viewModel.isTV && viewModel.seasons.isNotEmpty()) {
                    Spacer(modifier = Modifier.height(8.dp))
                    val navController = LocalNavController.current
                    EpisodesSection(
                        viewModel = viewModel,
                        onEpisodeClick = { season, episode ->
                            navController.navigate(
                                NavRoutes.Player(
                                    tmdbId = viewModel.tmdbId,
                                    mediaType = viewModel.mediaType,
                                    resumeSeason = season,
                                    resumeEpisode = episode,
                                    title = item.title ?: item.name ?: "",
                                    poster = item.posterPath,
                                    releaseDate = item.releaseDate
                                )
                            )
                        }
                    )
                }

                // Reviews
                if (viewModel.reviews.isNotEmpty()) {
                    Spacer(modifier = Modifier.height(8.dp))
                    ReviewsSection(reviews = viewModel.reviews)
                }

                // Recommendations
                if (viewModel.recommendations.isNotEmpty()) {
                    Spacer(modifier = Modifier.height(8.dp))
                    val navController = LocalNavController.current
                    RecommendationsSection(
                        items = viewModel.recommendations,
                        onItemClick = { item ->
                            val type = item.mediaType ?: "movie"
                            navController.navigate(
                                NavRoutes.Detail(item.id, type, 0, 0)
                            )
                        }
                    )
                }

                Spacer(modifier = Modifier.height(24.dp))
            }
        }

        // Provider Picker
        if (viewModel.showProviderPicker) {
            AlertDialog(
                onDismissRequest = { viewModel.showProviderPicker = false },
                title = { Text("Scegli la versione") },
                text = {
                    Column {
                        Text("Quale di questi è il titolo giusto?")
                        Spacer(modifier = Modifier.height(8.dp))
                        viewModel.providerCandidates.forEach { candidate ->
                            TextButton(
                                onClick = { viewModel.confirmProviderCandidate(candidate) },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Column(horizontalAlignment = Alignment.Start) {
                                    Text(candidate.title)
                                    candidate.year?.let {
                                        Text(
                                            text = it.toString(),
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    }
                                }
                            }
                        }
                    }
                },
                confirmButton = {
                    TextButton(onClick = { viewModel.refreshProvider() }) {
                        Text("Aggiorna")
                    }
                },
                dismissButton = {
                    TextButton(onClick = { viewModel.showProviderPicker = false }) {
                        Text("Chiudi")
                    }
                }
            )
        }

    }
}

@Composable
private fun EpisodesSection(
    viewModel: DetailViewModel,
    onEpisodeClick: (season: Int, episode: Int) -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionHeader(
            title = "Episodi",
            icon = Icons.Filled.PlayCircle
        )

        // Season picker
        val seasonsScrollState = rememberScrollState()
        val canScrollLeft = seasonsScrollState.value > 0
        val canScrollRight = seasonsScrollState.value < seasonsScrollState.maxValue
        val showScrollHints = viewModel.seasons.size > 8
        val fadeBg = MaterialTheme.colorScheme.background.copy(alpha = 0.95f)
        Box(modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .then(
                        if (showScrollHints) {
                            Modifier
                                .horizontalScroll(seasonsScrollState)
                                .padding(start = 28.dp, end = 28.dp)
                        } else Modifier
                    ),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                viewModel.seasons.forEach { season ->
                    val selected = season == viewModel.selectedSeason
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(
                                if (selected) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.surfaceVariant
                            )
                            .clickable { viewModel.changeSeason(season) }
                            .padding(horizontal = 12.dp, vertical = 6.dp)
                    ) {
                        Text(
                            text = "S$season",
                            style = MaterialTheme.typography.labelMedium,
                            color = if (selected) MaterialTheme.colorScheme.onPrimary
                            else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
            if (showScrollHints) {
                Box(
                    modifier = Modifier
                        .align(Alignment.CenterStart)
                        .width(28.dp)
                        .fillMaxHeight()
                        .background(
                            Brush.horizontalGradient(
                                colors = listOf(fadeBg, Color.Transparent)
                            )
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Filled.KeyboardArrowLeft,
                        contentDescription = "Scorri a sinistra",
                        tint = MaterialTheme.colorScheme.onBackground.copy(alpha = if (canScrollLeft) 0.7f else 0f),
                        modifier = Modifier.size(20.dp)
                    )
                }
                Box(
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .width(28.dp)
                        .fillMaxHeight()
                        .background(
                            Brush.horizontalGradient(
                                colors = listOf(Color.Transparent, fadeBg)
                            )
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                        contentDescription = "Scorri a destra",
                        tint = MaterialTheme.colorScheme.onBackground.copy(alpha = if (canScrollRight) 0.7f else 0f),
                        modifier = Modifier.size(20.dp)
                    )
                }
            }
        }

        if (viewModel.loadingEpisodes) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                items(4) {
                    SkeletonCard(width = 220.dp, modifier = Modifier.aspectRatio(16f / 9f))
                }
            }
        } else if (viewModel.episodes.isEmpty()) {
            Text(
                text = "Nessun episodio disponibile per questa stagione.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        } else {
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                contentPadding = PaddingValues(horizontal = 4.dp)
            ) {
                items(viewModel.episodes) { ep ->
                    val progress = viewModel.episodeProgresses[
                        Pair(ep.seasonNumber ?: viewModel.selectedSeason, ep.episodeNumber)
                    ]
                    EpisodeCard(
                        episode = ep,
                        positionSeconds = progress?.positionSeconds ?: 0.0,
                        durationSeconds = progress?.durationSeconds ?: 0.0,
                        onClick = {
                            onEpisodeClick(
                                ep.seasonNumber ?: viewModel.selectedSeason,
                                ep.episodeNumber
                            )
                        },
                        onDownload = {
                            viewModel.enqueueDownload(
                                season = ep.seasonNumber ?: viewModel.selectedSeason,
                                episode = ep.episodeNumber
                            )
                        }
                    )
                }
            }
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
private fun EpisodeCard(
    episode: TmdbEpisodeDetail,
    positionSeconds: Double = 0.0,
    durationSeconds: Double = 0.0,
    onClick: () -> Unit = {},
    onDownload: () -> Unit = {}
) {
    val watched = durationSeconds > 0 && positionSeconds >= durationSeconds * TVLogic.WATCHED_THRESHOLD
    val pct = when {
        watched -> 1f
        durationSeconds > 0 -> (positionSeconds / durationSeconds).toFloat().coerceIn(0f, 1f)
        else -> 0f
    }

    Column(
        modifier = Modifier
            .width(220.dp)
            .clickable(onClick = onClick)
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(16f / 9f)
                .clip(RoundedCornerShape(10.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant)
        ) {
            AsyncImage(
                model = TMDBImage.url(episode.stillPath, TMDBImage.Size.W300),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxWidth()
            )
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(Color.Transparent, Color.Black.copy(alpha = 0.75f))
                        )
                    )
                    .padding(8.dp),
                contentAlignment = Alignment.BottomStart
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.Bottom,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = "${episode.episodeNumber}",
                        style = MaterialTheme.typography.titleMedium,
                        color = Color.White
                    )
                    if (watched) {
                        Text(
                            text = "Visto",
                            style = MaterialTheme.typography.labelSmall,
                            color = Color.White.copy(alpha = 0.9f)
                        )
                    } else if (positionSeconds > 0 && durationSeconds > 0) {
                        Text(
                            text = "${formatClock(positionSeconds)} / ${formatClock(durationSeconds)}",
                            style = MaterialTheme.typography.labelSmall,
                            color = Color.White.copy(alpha = 0.9f)
                        )
                    }
                }
            }
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
            // White play/replay button centered over the still.
            Icon(
                imageVector = if (watched) Icons.Filled.Replay else Icons.Filled.PlayCircle,
                contentDescription = if (watched) "Riguarda" else "Riproduci",
                tint = Color.White,
                modifier = Modifier
                    .align(Alignment.Center)
                    .size(44.dp)
            )
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = episode.name ?: "Episodio ${episode.episodeNumber}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onBackground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )
        }
        episode.overview?.takeIf { it.isNotBlank() }?.let {
            Text(
                text = it,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
private fun ReviewsSection(reviews: List<TmdbReview>) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionHeader(
            title = "Recensioni",
            icon = Icons.Filled.Star
        )
        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            contentPadding = PaddingValues(horizontal = 4.dp)
        ) {
            items(reviews) { review ->
                ReviewCard(review = review)
            }
        }
    }
}

@Composable
private fun ReviewCard(review: TmdbReview) {
    Column(
        modifier = Modifier
            .width(300.dp)
            .background(
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                shape = RoundedCornerShape(12.dp)
            )
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = review.authorDetails?.name?.takeIf { it.isNotBlank() }
                        ?: review.authorDetails?.username?.takeIf { it.isNotBlank() }
                        ?: review.author.takeIf { it.isNotBlank() }
                        ?: "Anonimo",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onBackground
                )
            }
            review.authorDetails?.rating?.let {
                Text(
                    text = "★ ${String.format("%.1f", it)}",
                    style = MaterialTheme.typography.labelMedium,
                    color = Color(0xFFFFC107)
                )
            }
        }
        Text(
            text = review.content.trim().take(360).let {
                if (review.content.length > 360) "$it..." else it
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun RecommendationsSection(
    items: List<TmdbItem>,
    onItemClick: (TmdbItem) -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionHeader(
            title = "Ti potrebbe piacere",
            icon = Icons.Filled.ThumbUp
        )
        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            contentPadding = PaddingValues(horizontal = 4.dp)
        ) {
            items(items) { item ->
                val type = item.mediaType ?: "movie"
                MediaCard(
                    title = item.displayTitle,
                    posterUrl = TMDBImage.url(item.posterPath, TMDBImage.Size.W500),
                    onClick = { onItemClick(item) }
                )
            }
        }
    }
}

@Composable
private fun ErrorState(
    message: String,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = "Errore",
            style = MaterialTheme.typography.headlineSmall,
            color = MaterialTheme.colorScheme.onBackground
        )
        Text(
            text = message,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(modifier = Modifier.height(16.dp))
        Button(onClick = onRetry) {
            Text("Riprova")
        }
    }
}

@Composable
private fun DetailSkeleton(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        SkeletonBox(width = 220.dp, height = 30.dp)
        SkeletonBox(height = 50.dp)
        SkeletonBox(height = 46.dp)
        SkeletonBox(width = 160.dp, height = 14.dp)
        SkeletonBox(height = 14.dp)
        SkeletonBox(width = 240.dp, height = 14.dp)
    }
}

@Composable
private fun SkeletonBox(
    width: androidx.compose.ui.unit.Dp? = null,
    height: androidx.compose.ui.unit.Dp,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .then(if (width != null) Modifier.width(width) else Modifier.fillMaxWidth())
            .height(height)
            .clip(RoundedCornerShape(6.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
    )
}
