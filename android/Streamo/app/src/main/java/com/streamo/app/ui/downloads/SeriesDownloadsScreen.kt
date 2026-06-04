package com.streamo.app.ui.downloads

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.AlertDialog
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.streamo.app.data.local.entity.DownloadEntry
import com.streamo.app.data.remote.dto.TmdbEpisodeDetail

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SeriesDownloadsScreen(
    onNavigateToDetail: (Int, String, Int, Int) -> Unit = { _, _, _, _ -> },
    onNavigateToPlayer: (Int, String, Int, Int, String, String?, String?) -> Unit = { _, _, _, _, _, _, _ -> },
    onBack: () -> Unit = {},
    viewModel: SeriesDownloadsViewModel = hiltViewModel()
) {
    val downloadMap by viewModel.downloadMap.collectAsState()
    var episodeToDelete by remember { mutableStateOf<Int?>(null) }
    var entryToDelete by remember { mutableStateOf<DownloadEntry?>(null) }
    var confirmDeleteAll by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        viewModel.load()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "Download (${viewModel.title})",
                        style = MaterialTheme.typography.titleLarge
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
                actions = {
                    if (viewModel.showAllEpisodes) {
                        val hasDownloads = downloadMap.isNotEmpty()
                        IconButton(onClick = { viewModel.downloadAll() }) {
                            Icon(
                                imageVector = Icons.Filled.Download,
                                contentDescription = "Scarica tutte",
                                tint = MaterialTheme.colorScheme.primary
                            )
                        }
                        IconButton(
                            onClick = { confirmDeleteAll = true },
                            enabled = hasDownloads
                        ) {
                            Icon(
                                imageVector = Icons.Filled.DeleteSweep,
                                contentDescription = "Elimina tutto",
                                tint = if (hasDownloads) MaterialTheme.colorScheme.error
                                    else MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background.copy(alpha = 0.9f),
                    titleContentColor = MaterialTheme.colorScheme.onBackground
                )
            )
        }
    ) { paddingValues ->
        if (viewModel.showAllEpisodes) {
            // Mode: coming from DetailScreen → show ALL episodes grouped by season
            AllEpisodesContent(
                viewModel = viewModel,
                downloadMap = downloadMap,
                paddingValues = paddingValues,
                onToggleDownload = { season, episode ->
                    viewModel.toggleEpisodeDownload(season, episode)
                },
                onRequestDelete = { episode ->
                    episodeToDelete = episode
                },
                onNavigateToPlayer = onNavigateToPlayer,
                onNavigateToDetail = onNavigateToDetail
            )
        } else {
            // Mode: coming from global Downloads → show only downloaded episodes
            DownloadedOnlyContent(
                viewModel = viewModel,
                paddingValues = paddingValues,
                onRequestDelete = { entry ->
                    entryToDelete = entry
                },
                onNavigateToPlayer = onNavigateToPlayer,
                onNavigateToDetail = onNavigateToDetail
            )
        }

        // Confirm delete dialog for single episode (AllEpisodes mode)
        episodeToDelete?.let { epNum ->
            AlertDialog(
                onDismissRequest = { episodeToDelete = null },
                title = { Text("Elimina download") },
                text = { Text("Vuoi eliminare il download dell'episodio $epNum?") },
                confirmButton = {
                    TextButton(
                        onClick = {
                            viewModel.toggleEpisodeDownload(viewModel.selectedSeason, epNum)
                            episodeToDelete = null
                        }
                    ) {
                        Text("Elimina", color = MaterialTheme.colorScheme.error)
                    }
                },
                dismissButton = {
                    TextButton(onClick = { episodeToDelete = null }) {
                        Text("Annulla", color = MaterialTheme.colorScheme.onSurface)
                    }
                }
            )
        }

        // Confirm delete dialog for downloaded entry (DownloadedOnly mode)
        entryToDelete?.let { entry ->
            AlertDialog(
                onDismissRequest = { entryToDelete = null },
                title = { Text("Elimina download") },
                text = { Text("Vuoi eliminare il download di \"${entry.title}\"?") },
                confirmButton = {
                    TextButton(
                        onClick = {
                            viewModel.removeDownload(entry)
                            entryToDelete = null
                        }
                    ) {
                        Text("Elimina", color = MaterialTheme.colorScheme.error)
                    }
                },
                dismissButton = {
                    TextButton(onClick = { entryToDelete = null }) {
                        Text("Annulla", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            )
        }

        // Confirm delete-all dialog
        if (confirmDeleteAll) {
            AlertDialog(
                onDismissRequest = { confirmDeleteAll = false },
                title = { Text("Elimina tutto") },
                text = { Text("Vuoi eliminare tutti i download di questa serie?") },
                confirmButton = {
                    TextButton(
                        onClick = {
                            viewModel.removeAll()
                            confirmDeleteAll = false
                        }
                    ) {
                        Text("Elimina tutto", color = MaterialTheme.colorScheme.error)
                    }
                },
                dismissButton = {
                    TextButton(onClick = { confirmDeleteAll = false }) {
                        Text("Annulla", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            )
        }
    }
}

@Composable
private fun AllEpisodesContent(
    viewModel: SeriesDownloadsViewModel,
    downloadMap: Map<String, DownloadEntry>,
    paddingValues: PaddingValues,
    onToggleDownload: (Int, Int) -> Unit,
    onRequestDelete: (Int) -> Unit,
    onNavigateToPlayer: (Int, String, Int, Int, String, String?, String?) -> Unit,
    onNavigateToDetail: (Int, String, Int, Int) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(paddingValues)
    ) {
        // Season picker with scroll arrows
        if (viewModel.seasons.size > 1) {
            val scrollState = rememberScrollState()
            val canScrollLeft = scrollState.value > 0
            val canScrollRight = scrollState.value < scrollState.maxValue
            val showScrollHints = viewModel.seasons.size > 8
            val fadeBg = MaterialTheme.colorScheme.background.copy(alpha = 0.95f)
            Box(modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .then(
                            if (showScrollHints) {
                                Modifier
                                    .horizontalScroll(scrollState)
                                    .padding(start = 28.dp, end = 28.dp)
                            } else Modifier
                        )
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
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
                                .padding(horizontal = 14.dp, vertical = 8.dp)
                        ) {
                            Text(
                                text = "S$season",
                                color = if (selected) MaterialTheme.colorScheme.onPrimary
                                else MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.labelMedium
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
        }

        if (viewModel.loadingAllEpisodes) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator()
            }
        } else if (viewModel.loadError != null) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = viewModel.loadError ?: "Errore",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                items(viewModel.allEpisodes, key = { it.episodeNumber }) { ep ->
                    val contentId = "${viewModel.tmdbId}_tv_${viewModel.selectedSeason}_${ep.episodeNumber}"
                    val entry = downloadMap[contentId]
                    val status = entry?.status
                    val isActive = status == "downloading" || status == "pending" || status == "resolving" || status == "paused"
                    val progress = entry?.downloadPercentage ?: 0f

                    EpisodeDownloadRow(
                        episode = ep,
                        status = status,
                        isActive = isActive,
                        progress = progress,
                        bytesDownloaded = entry?.bytesDownloaded ?: 0L,
                        bytesTotal = entry?.bytesTotal ?: 0L,
                        bytesPerSecond = entry?.bytesPerSecond ?: 0L,
                        onDownload = {
                            onToggleDownload(viewModel.selectedSeason, ep.episodeNumber)
                        },
                        onPlay = {
                            if (entry != null && status == "completed") {
                                onNavigateToPlayer(
                                    entry.tmdbId,
                                    entry.mediaType,
                                    entry.season,
                                    entry.episode,
                                    entry.title,
                                    entry.posterPath,
                                    null
                                )
                            }
                        },
                        onRequestDelete = {
                            onRequestDelete(ep.episodeNumber)
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun EpisodeDownloadRow(
    episode: TmdbEpisodeDetail,
    status: String?,
    isActive: Boolean,
    progress: Float,
    bytesDownloaded: Long = 0L,
    bytesTotal: Long = 0L,
    bytesPerSecond: Long = 0L,
    onDownload: () -> Unit,
    onPlay: () -> Unit,
    onRequestDelete: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Episodio ${episode.episodeNumber}${episode.name?.let { " — $it" } ?: ""}",
                        style = MaterialTheme.typography.bodyMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    status?.let {
                        Text(
                            text = statusLabel(it),
                            style = MaterialTheme.typography.bodySmall,
                            color = statusColor(it)
                        )
                    }
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    when {
                        status == "completed" -> {
                            IconButton(onClick = onPlay, modifier = Modifier.size(40.dp)) {
                                Icon(
                                    imageVector = Icons.Filled.PlayCircle,
                                    contentDescription = "Riproduci",
                                    tint = MaterialTheme.colorScheme.primary
                                )
                            }
                            IconButton(onClick = onRequestDelete, modifier = Modifier.size(40.dp)) {
                                Icon(
                                    imageVector = Icons.Filled.Delete,
                                    contentDescription = "Elimina",
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                        isActive -> {
                            IconButton(onClick = onRequestDelete, modifier = Modifier.size(40.dp)) {
                                Icon(
                                    imageVector = Icons.Filled.Stop,
                                    contentDescription = "Interrompi",
                                    tint = Color.White
                                )
                            }
                        }
                        status == "failed" -> {
                            Icon(
                                imageVector = Icons.Filled.Close,
                                contentDescription = "Errore",
                                tint = MaterialTheme.colorScheme.error,
                                modifier = Modifier.size(24.dp)
                            )
                            IconButton(onClick = onRequestDelete, modifier = Modifier.size(40.dp)) {
                                Icon(
                                    imageVector = Icons.Filled.Delete,
                                    contentDescription = "Elimina",
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                        else -> {
                            IconButton(onClick = onDownload, modifier = Modifier.size(40.dp)) {
                                Icon(
                                    imageVector = Icons.Filled.Download,
                                    contentDescription = "Scarica",
                                    tint = MaterialTheme.colorScheme.primary
                                )
                            }
                        }
                    }
                }
            }

            when {
                status == "downloading" && progress > 0f -> {
                    Spacer(modifier = Modifier.height(6.dp))
                    val pct = (progress / 100f).coerceIn(0f, 1f)
                    LinearProgressIndicator(
                        progress = { pct },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(4.dp)
                            .clip(RoundedCornerShape(2.dp)),
                        color = MaterialTheme.colorScheme.primary,
                        trackColor = Color.DarkGray,
                        drawStopIndicator = {}
                    )
                    Text(
                        text = downloadDetailLine(progress, bytesDownloaded, bytesTotal, bytesPerSecond),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 2.dp)
                    )
                }
                status == "downloading" && progress <= 0f || status == "pending" || status == "resolving" || status == "paused" -> {
                    Spacer(modifier = Modifier.height(6.dp))
                    LinearProgressIndicator(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(4.dp)
                            .clip(RoundedCornerShape(2.dp)),
                        color = MaterialTheme.colorScheme.primary,
                        trackColor = Color.DarkGray
                    )
                    val detail = downloadDetailLine(0f, bytesDownloaded, bytesTotal, bytesPerSecond)
                    if (detail.isNotEmpty()) {
                        Text(
                            text = detail,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 2.dp)
                        )
                    }
                }
            }

            episode.overview?.takeIf { it.isNotBlank() }?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 4.dp)
                )
            }
        }
    }
}

@Composable
private fun DownloadedOnlyContent(
    viewModel: SeriesDownloadsViewModel,
    paddingValues: PaddingValues,
    onRequestDelete: (DownloadEntry) -> Unit,
    onNavigateToPlayer: (Int, String, Int, Int, String, String?, String?) -> Unit,
    onNavigateToDetail: (Int, String, Int, Int) -> Unit
) {
    val entries by viewModel.dbEntries.collectAsState(initial = emptyList())

    if (entries.isEmpty()) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(24.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "Nessun download per questa serie.",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    } else {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(entries.sortedBy { it.season * 1000 + it.episode }, key = { it.id }) { entry ->
                val epDetail = viewModel.episodeDetails[Pair(entry.season, entry.episode)]
                DownloadCard(
                    entry = entry,
                    overview = epDetail?.overview,
                    episodeName = epDetail?.name,
                    onStop = { viewModel.stop(entry) },
                    onRestart = { viewModel.restart(entry) },
                    onClick = {
                        if (entry.status == "completed") {
                            onNavigateToPlayer(
                                entry.tmdbId,
                                entry.mediaType,
                                entry.season,
                                entry.episode,
                                entry.title,
                                entry.posterPath,
                                null
                            )
                        } else {
                            onNavigateToDetail(
                                entry.tmdbId,
                                entry.mediaType,
                                entry.season,
                                entry.episode
                            )
                        }
                    },
                    onRequestDelete = { onRequestDelete(entry) }
                )
            }
        }
    }
}
