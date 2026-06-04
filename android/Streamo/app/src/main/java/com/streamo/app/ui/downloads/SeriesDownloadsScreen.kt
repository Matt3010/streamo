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
import androidx.compose.foundation.layout.statusBars
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
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
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
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

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
        contentWindowInsets = androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0),
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
                    containerColor = MaterialTheme.colorScheme.background,
                    scrolledContainerColor = MaterialTheme.colorScheme.background,
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

        // Rilevamento risoluzioni in corso (prima della modale "Chiedi").
        if (viewModel.qualityResolving) {
            AlertDialog(
                onDismissRequest = {},
                confirmButton = {},
                title = { Text("Qualità download") },
                text = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                        Spacer(modifier = Modifier.size(12.dp))
                        Text("Rilevo le risoluzioni disponibili…")
                    }
                }
            )
        }

        // Scelta qualità download (preferenza "Chiedi").
        viewModel.qualityRequest?.let { req ->
            DownloadQualityDialog(
                request = req,
                onConfirm = { pref, save -> viewModel.confirmQuality(pref, save) },
                onDismiss = { viewModel.dismissQuality() }
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
                                Modifier.horizontalScroll(scrollState)
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
                            .then(
                                if (canScrollLeft) Modifier.background(
                                    Brush.horizontalGradient(
                                        colors = listOf(fadeBg, Color.Transparent)
                                    )
                                ) else Modifier
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
                            .then(
                                if (canScrollRight) Modifier.background(
                                    Brush.horizontalGradient(
                                        colors = listOf(Color.Transparent, fadeBg)
                                    )
                                ) else Modifier
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

                    EpisodeDownloadCard(
                        episodeNumber = ep.episodeNumber,
                        episodeName = ep.name,
                        overview = ep.overview,
                        stillPath = ep.stillPath,
                        entry = entry,
                        onDownload = {
                            onToggleDownload(viewModel.selectedSeason, ep.episodeNumber)
                        },
                        onStop = { entry?.let { viewModel.stop(it) } },
                        onRestart = { entry?.let { viewModel.restart(it) } },
                        onPlay = {
                            if (entry != null && entry.status == "completed") {
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

/**
 * Card episodio condivisa (lista dettaglio + lista download globale): anteprima still
 * quadrata con play sopra se completato, titolo + stato, cluster bottoni (scarica / pausa /
 * riprendi + elimina), barra progresso con %·MB sempre (se ci sono dati) e velocità solo
 * durante il download, descrizione episodio sotto.
 *
 * `entry` nullo = episodio non ancora scaricato (mostra solo il bottone Scarica).
 */
@Composable
internal fun EpisodeDownloadCard(
    episodeNumber: Int,
    episodeName: String?,
    overview: String?,
    stillPath: String?,
    entry: DownloadEntry?,
    onDownload: () -> Unit,
    onStop: () -> Unit,
    onRestart: () -> Unit,
    onPlay: () -> Unit,
    onRequestDelete: () -> Unit
) {
    val status = entry?.status
    val isActive = status == "downloading" || status == "pending" || status == "resolving"
    val isPaused = status == "paused"
    val isCompleted = status == "completed"
    val isFailed = status == "failed"
    val hasEntry = entry != null
    val progress = entry?.downloadPercentage ?: 0f
    val bytesDownloaded = entry?.bytesDownloaded ?: 0L
    val bytesTotal = entry?.bytesTotal ?: 0L
    val bytesPerSecond = entry?.bytesPerSecond ?: 0L

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .let { if (isCompleted) it.clickable(onClick = onPlay) else it },
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Anteprima episodio quadrata; se completato, play centrale sopra (come nel dettaglio).
                Box(
                    modifier = Modifier
                        .size(64.dp)
                        .let { if (isCompleted) it.clickable(onClick = onPlay) else it },
                    contentAlignment = Alignment.Center
                ) {
                    PosterThumb(
                        posterPath = stillPath ?: entry?.stillPath ?: entry?.posterPath,
                        modifier = Modifier.fillMaxSize()
                    )
                    if (isCompleted) {
                        // Scrim scuro così il play resta visibile su still chiare.
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .clip(RoundedCornerShape(8.dp))
                                .background(Color.Black.copy(alpha = 0.35f))
                        )
                        Icon(
                            imageVector = Icons.Filled.PlayCircle,
                            contentDescription = "Riproduci",
                            tint = Color.White,
                            modifier = Modifier.size(36.dp)
                        )
                    }
                }
                Spacer(modifier = Modifier.size(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Episodio $episodeNumber${episodeName?.let { " — $it" } ?: ""}",
                        style = MaterialTheme.typography.bodyMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = status?.let { statusLabel(it) } ?: "Non scaricato",
                        style = MaterialTheme.typography.bodySmall,
                        color = status?.let { statusColor(it) }
                            ?: MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (isActive) {
                        IconButton(onClick = onStop, modifier = Modifier.size(40.dp)) {
                            Icon(
                                imageVector = Icons.Filled.Pause,
                                contentDescription = "Metti in pausa il download",
                                tint = Color.White
                            )
                        }
                    }
                    if (isPaused) {
                        IconButton(onClick = onRestart, modifier = Modifier.size(40.dp)) {
                            Icon(
                                imageVector = Icons.Filled.PlayArrow,
                                contentDescription = "Riprendi il download",
                                tint = Color.White
                            )
                        }
                    }
                    if (isFailed) {
                        Icon(
                            imageVector = Icons.Filled.Close,
                            contentDescription = "Errore",
                            tint = MaterialTheme.colorScheme.error,
                            modifier = Modifier.size(24.dp)
                        )
                    }
                    if (!hasEntry || isFailed) {
                        IconButton(onClick = onDownload, modifier = Modifier.size(40.dp)) {
                            Icon(
                                imageVector = Icons.Filled.Download,
                                contentDescription = "Scarica",
                                tint = MaterialTheme.colorScheme.primary
                            )
                        }
                    }
                    if (hasEntry) {
                        IconButton(onClick = onRequestDelete, modifier = Modifier.size(40.dp)) {
                            Icon(
                                imageVector = Icons.Filled.Delete,
                                contentDescription = "Elimina download",
                                tint = MaterialTheme.colorScheme.error
                            )
                        }
                    }
                }
            }

            // Barra progresso solo durante download/pausa. % e MB sempre se ci sono dati;
            // la velocità solo mentre sta scaricando.
            val showBar = isActive || isPaused
            if (showBar) {
                Spacer(modifier = Modifier.height(6.dp))
                if (progress > 0f) {
                    LinearProgressIndicator(
                        progress = { (progress / 100f).coerceIn(0f, 1f) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(4.dp)
                            .clip(RoundedCornerShape(2.dp)),
                        color = MaterialTheme.colorScheme.primary,
                        trackColor = Color.DarkGray,
                        drawStopIndicator = {}
                    )
                } else {
                    LinearProgressIndicator(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(4.dp)
                            .clip(RoundedCornerShape(2.dp)),
                        color = MaterialTheme.colorScheme.primary,
                        trackColor = Color.DarkGray
                    )
                }
            }
            val detail = if (isCompleted) {
                // Completato: qualità · dimensione · data, niente percentuale/velocità.
                val parts = mutableListOf<String>()
                entry?.quality?.takeIf { it.isNotBlank() }?.let { parts += it }
                (bytesDownloaded.takeIf { it > 0 } ?: bytesTotal)
                    .takeIf { it > 0 }
                    ?.let { parts += formatBytes(it) }
                entry?.createdAt?.let {
                    parts += SimpleDateFormat("dd/MM/yyyy", Locale.getDefault()).format(Date(it))
                }
                parts.joinToString(" · ")
            } else {
                downloadDetailLine(
                    percentage = progress,
                    bytesDownloaded = bytesDownloaded,
                    bytesTotal = bytesTotal,
                    // Velocità solo durante il download attivo.
                    bytesPerSecond = if (status == "downloading") bytesPerSecond else 0L
                )
            }
            if (detail.isNotEmpty()) {
                Text(
                    text = detail,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = if (showBar) 2.dp else 6.dp)
                )
            }

            overview?.takeIf { it.isNotBlank() }?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 6.dp)
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
                EpisodeDownloadCard(
                    episodeNumber = entry.episode,
                    episodeName = epDetail?.name,
                    overview = epDetail?.overview,
                    stillPath = epDetail?.stillPath,
                    entry = entry,
                    onDownload = { viewModel.restart(entry) },
                    onStop = { viewModel.stop(entry) },
                    onRestart = { viewModel.restart(entry) },
                    onPlay = {
                        onNavigateToPlayer(
                            entry.tmdbId,
                            entry.mediaType,
                            entry.season,
                            entry.episode,
                            entry.title,
                            entry.posterPath,
                            null
                        )
                    },
                    onRequestDelete = { onRequestDelete(entry) }
                )
            }
        }
    }
}
