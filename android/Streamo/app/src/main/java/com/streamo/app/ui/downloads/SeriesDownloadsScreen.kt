package com.streamo.app.ui.downloads

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Checkbox
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
import androidx.compose.runtime.mutableStateListOf
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
import com.streamo.app.navigation.LocalBottomBarPadding
import com.streamo.app.ui.common.GlassAlertDialog
import com.streamo.app.ui.common.GlassCard
import com.streamo.app.ui.common.GlassDialogDestructiveButton
import com.streamo.app.ui.common.GlassDialogNeutralButton
import com.streamo.app.ui.common.GlassLargeTitle
import com.streamo.app.ui.common.GlassTopBarScaffold
import com.streamo.app.ui.common.LocalHazeState
import com.streamo.app.ui.common.SeasonChip
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SeriesDownloadsScreen(
    onNavigateToDetail: (Int, String, Int, Int) -> Unit = { _, _, _, _ -> },
    onNavigateToPlayer: (Int, String, Int, Int, String, String?, String?) -> Unit = { _, _, _, _, _, _, _ -> },
    onNavigateToAdvanced: () -> Unit = {},
    onBack: () -> Unit = {},
    viewModel: SeriesDownloadsViewModel = hiltViewModel()
) {
    val downloadMap by viewModel.downloadMap.collectAsState()
    val dbEntries by viewModel.dbEntries.collectAsState(initial = emptyList())
    val warpChangedEntry by viewModel.warpChangedEntry.collectAsState()
    var episodeToDelete by remember { mutableStateOf<Int?>(null) }
    var entryToDelete by remember { mutableStateOf<DownloadEntry?>(null) }
    var confirmDeleteAll by remember { mutableStateOf(false) }

    // Multi-select. Chiavi: numero episodio (modalità tutti-episodi) o id entry (solo scaricati).
    var selectionMode by remember { mutableStateOf(false) }
    val selectedKeys = remember { mutableStateListOf<Int>() }
    var confirmBulkDelete by remember { mutableStateOf(false) }
    fun exitSelection() {
        selectionMode = false
        selectedKeys.clear()
    }

    LaunchedEffect(Unit) {
        viewModel.load()
    }
    // Cambio stagione azzera la selezione (i numeri episodio cambiano significato).
    LaunchedEffect(viewModel.selectedSeason) { exitSelection() }
    BackHandler(enabled = selectionMode) { exitSelection() }

    // Sottoinsiemi della selezione usati dalle azioni della barra.
    fun contentIdFor(episode: Int) = "${viewModel.tmdbId}_tv_${viewModel.selectedSeason}_$episode"
    val selectedDeletable: List<DownloadEntry> = if (viewModel.showAllEpisodes) {
        selectedKeys.mapNotNull { downloadMap[contentIdFor(it)] }
    } else {
        dbEntries.filter { it.id in selectedKeys }
    }
    val selectedDownloadable: List<Int> = if (viewModel.showAllEpisodes) {
        selectedKeys.filter { downloadMap[contentIdFor(it)] == null }
    } else emptyList()

    GlassTopBarScaffold(
        onLeading = { if (selectionMode) exitSelection() else onBack() },
        leadingIcon = if (selectionMode) Icons.Filled.Close
            else Icons.AutoMirrored.Filled.ArrowBack,
        leadingDesc = if (selectionMode) "Annulla selezione" else "Indietro",
        actions = if (selectionMode) {
            {
                val allKeys = if (viewModel.showAllEpisodes) {
                    viewModel.allEpisodes.map { it.episodeNumber }
                } else {
                    dbEntries.map { it.id }
                }
                val allSelected = allKeys.isNotEmpty() && allKeys.all { it in selectedKeys }
                Text(
                    "Tutti",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Checkbox(
                    checked = allSelected,
                    onCheckedChange = {
                        selectedKeys.clear()
                        if (!allSelected) selectedKeys.addAll(allKeys)
                    }
                )
                if (viewModel.showAllEpisodes && selectedDownloadable.isNotEmpty()) {
                    IconButton(onClick = {
                        viewModel.downloadEpisodes(viewModel.selectedSeason, selectedDownloadable)
                        exitSelection()
                    }) {
                        Icon(
                            imageVector = Icons.Filled.Download,
                            contentDescription = "Scarica selezionati",
                            tint = Color.White
                        )
                    }
                }
                IconButton(
                    onClick = { confirmBulkDelete = true },
                    enabled = selectedDeletable.isNotEmpty()
                ) {
                    Icon(
                        imageVector = Icons.Filled.Delete,
                        contentDescription = "Elimina selezionati",
                        tint = if (selectedDeletable.isNotEmpty()) MaterialTheme.colorScheme.error
                            else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        } else if (viewModel.showAllEpisodes) {
            {
                val hasDownloads = downloadMap.isNotEmpty()
                IconButton(onClick = { viewModel.downloadAll() }) {
                    Icon(
                        imageVector = Icons.Filled.Download,
                        contentDescription = "Scarica tutte",
                        tint = Color.White
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
        } else null
    ) { topPadding ->
        if (viewModel.showAllEpisodes) {
            // Mode: coming from DetailScreen → show ALL episodes grouped by season
            AllEpisodesContent(
                viewModel = viewModel,
                downloadMap = downloadMap,
                title = if (selectionMode) "${selectedKeys.size} selezionati"
                    else "Download (${viewModel.title})",
                topPadding = topPadding,
                selectionMode = selectionMode,
                isSelected = { ep -> ep in selectedKeys },
                onToggleSelection = { ep ->
                    if (ep in selectedKeys) selectedKeys.remove(ep) else selectedKeys.add(ep)
                },
                onLongPress = { ep ->
                    if (!selectionMode) {
                        selectionMode = true
                        selectedKeys.add(ep)
                    }
                },
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
                entries = dbEntries,
                title = if (selectionMode) "${selectedKeys.size} selezionati"
                    else "Download (${viewModel.title})",
                topPadding = topPadding,
                selectionMode = selectionMode,
                isSelected = { id -> id in selectedKeys },
                onToggleSelection = { id ->
                    if (id in selectedKeys) selectedKeys.remove(id) else selectedKeys.add(id)
                },
                onLongPress = { id ->
                    if (!selectionMode) {
                        selectionMode = true
                        selectedKeys.add(id)
                    }
                },
                onRequestDelete = { entry ->
                    entryToDelete = entry
                },
                onNavigateToPlayer = onNavigateToPlayer,
                onNavigateToDetail = onNavigateToDetail
            )
        }

    }

// Confirm delete dialog for single episode (AllEpisodes mode)
episodeToDelete?.let { epNum ->
    GlassAlertDialog(
        onDismissRequest = { episodeToDelete = null },
        hazeState = LocalHazeState.current,
        title = "Elimina download",
        text = { Text("Vuoi eliminare il download dell'episodio $epNum?") },
        confirmButton = {
            GlassDialogDestructiveButton(
                onClick = {
                    viewModel.toggleEpisodeDownload(viewModel.selectedSeason, epNum)
                    episodeToDelete = null
                }
            ) {
                Text("Elimina")
            }
        },
        dismissButton = {
            GlassDialogNeutralButton(onClick = { episodeToDelete = null }) {
                Text("Annulla")
            }
        }
    )
}

// Confirm delete dialog for downloaded entry (DownloadedOnly mode)
entryToDelete?.let { entry ->
    GlassAlertDialog(
        onDismissRequest = { entryToDelete = null },
        hazeState = LocalHazeState.current,
        title = "Elimina download",
        text = { Text("Vuoi eliminare il download di \"${entry.title}\"?") },
        confirmButton = {
            GlassDialogDestructiveButton(
                onClick = {
                    viewModel.removeDownload(entry)
                    entryToDelete = null
                }
            ) {
                Text("Elimina")
            }
        },
        dismissButton = {
            GlassDialogNeutralButton(onClick = { entryToDelete = null }) {
                Text("Annulla")
            }
        }
    )
}

// Rilevamento risoluzioni in corso (prima della modale "Chiedi").
if (viewModel.qualityResolving) {
    GlassAlertDialog(
        onDismissRequest = {},
        confirmButton = {},
        hazeState = LocalHazeState.current,
        title = "Qualità download",
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
        onDismiss = { viewModel.dismissQuality() },
        hazeState = LocalHazeState.current
    )
}

// Confirm delete-all dialog
if (confirmDeleteAll) {
    GlassAlertDialog(
        onDismissRequest = { confirmDeleteAll = false },
        hazeState = LocalHazeState.current,
        title = "Elimina tutto",
        text = { Text("Vuoi eliminare tutti i download di questa serie?") },
        confirmButton = {
            GlassDialogDestructiveButton(
                onClick = {
                    viewModel.removeAll()
                    confirmDeleteAll = false
                }
            ) {
                Text("Elimina tutto")
            }
        },
        dismissButton = {
            GlassDialogNeutralButton(onClick = { confirmDeleteAll = false }) {
                Text("Annulla")
            }
        }
    )
}

// Confirm bulk delete dialog (multi-select)
if (confirmBulkDelete) {
    val count = selectedDeletable.size
    val toDelete = selectedDeletable.toList()
    GlassAlertDialog(
        onDismissRequest = { confirmBulkDelete = false },
        hazeState = LocalHazeState.current,
        title = "Elimina download",
        text = { Text("Vuoi eliminare $count download selezionati?") },
        confirmButton = {
            GlassDialogDestructiveButton(
                onClick = {
                    viewModel.removeMany(toDelete)
                    confirmBulkDelete = false
                    exitSelection()
                }
            ) {
                Text("Elimina")
            }
        },
        dismissButton = {
            GlassDialogNeutralButton(onClick = { confirmBulkDelete = false }) {
                Text("Annulla")
            }
        }
    )
}

// WARP state changed warning dialog
warpChangedEntry?.let { (entry, currentWarp) ->
    GlassAlertDialog(
        onDismissRequest = { viewModel.clearWarpWarning() },
        hazeState = LocalHazeState.current,
        title = "WARP cambiato",
        text = {
            Column {
                Text(
                    if (currentWarp)
                        "Questo download è stato avviato senza WARP. Ora WARP è attivo: verrà scaricato di nuovo da capo."
                    else
                        "Questo download è stato avviato con WARP. Ora WARP è disattivo: verrà scaricato di nuovo da capo."
                )
                Spacer(Modifier.height(12.dp))
                TextButton(onClick = { viewModel.clearWarpWarning(); onNavigateToAdvanced() }) {
                    Icon(Icons.Filled.Settings, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Impostazioni WARP")
                }
            }
        },
        confirmButton = {
            GlassDialogDestructiveButton(onClick = { viewModel.restartAnyway(entry) }) {
                Text("Scarica di nuovo")
            }
        },
        dismissButton = {
            GlassDialogNeutralButton(onClick = { viewModel.clearWarpWarning() }) {
                Text("Annulla")
            }
        }
    )
}
}

@Composable
private fun AllEpisodesContent(
    viewModel: SeriesDownloadsViewModel,
    downloadMap: Map<String, DownloadEntry>,
    title: String,
    topPadding: androidx.compose.ui.unit.Dp,
    selectionMode: Boolean,
    isSelected: (Int) -> Boolean,
    onToggleSelection: (Int) -> Unit,
    onLongPress: (Int) -> Unit,
    onToggleDownload: (Int, Int) -> Unit,
    onRequestDelete: (Int) -> Unit,
    onNavigateToPlayer: (Int, String, Int, Int, String, String?, String?) -> Unit,
    onNavigateToDetail: (Int, String, Int, Int) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(top = topPadding)
    ) {
        // Season picker with scroll fade
        if (viewModel.seasons.size > 1) {
            val scrollState = rememberScrollState()
            val canScrollLeft = scrollState.value > 0
            val canScrollRight = scrollState.value < scrollState.maxValue
            val showScrollHints = viewModel.seasons.size > 8
            val fadeBg = MaterialTheme.colorScheme.background.copy(alpha = 0.95f)
            val hintWidth = 56.dp
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
                        SeasonChip(
                            season = season,
                            selected = season == viewModel.selectedSeason,
                            onClick = { viewModel.changeSeason(season) }
                        )
                    }
                }
                if (showScrollHints) {
                    // Fade sinistro
                    Box(
                        modifier = Modifier
                            .align(Alignment.CenterStart)
                            .width(hintWidth)
                            .fillMaxHeight()
                            .then(
                                if (canScrollLeft) Modifier.background(
                                    Brush.horizontalGradient(
                                        colors = listOf(fadeBg, Color.Transparent)
                                    )
                                ) else Modifier
                            )
                    )
                    // Fade destro
                    Box(
                        modifier = Modifier
                            .align(Alignment.CenterEnd)
                            .width(hintWidth)
                            .fillMaxHeight()
                            .then(
                                if (canScrollRight) Modifier.background(
                                    Brush.horizontalGradient(
                                        colors = listOf(Color.Transparent, fadeBg)
                                    )
                                ) else Modifier
                            )
                    )
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
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 8.dp + LocalBottomBarPadding.current),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                item {
                    GlassLargeTitle(title)
                }
                items(viewModel.allEpisodes, key = { it.episodeNumber }) { ep ->
                    val contentId = "${viewModel.tmdbId}_tv_${viewModel.selectedSeason}_${ep.episodeNumber}"
                    val entry = downloadMap[contentId]

                    EpisodeDownloadCard(
                        episodeNumber = ep.episodeNumber,
                        episodeName = ep.name,
                        overview = ep.overview,
                        stillPath = ep.stillPath,
                        entry = entry,
                        selectionMode = selectionMode,
                        selected = isSelected(ep.episodeNumber),
                        onToggleSelection = { onToggleSelection(ep.episodeNumber) },
                        onLongPress = { onLongPress(ep.episodeNumber) },
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
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun EpisodeDownloadCard(
    episodeNumber: Int,
    episodeName: String?,
    overview: String?,
    stillPath: String?,
    entry: DownloadEntry?,
    selectionMode: Boolean = false,
    selected: Boolean = false,
    onToggleSelection: () -> Unit = {},
    onLongPress: () -> Unit = {},
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

    GlassCard(
        modifier = Modifier
            .fillMaxWidth()
            .combinedClickable(
                onClick = {
                    if (selectionMode) onToggleSelection()
                    else if (isCompleted) onPlay()
                },
                onLongClick = onLongPress
            )
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
                        .let { if (isCompleted && !selectionMode) it.clickable(onClick = onPlay) else it },
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

                SelectionCheckbox(
                    selectionMode = selectionMode,
                    selected = selected,
                    onToggle = onToggleSelection
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (!selectionMode) {
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
                                    tint = Color.White
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
    entries: List<DownloadEntry>,
    title: String,
    topPadding: androidx.compose.ui.unit.Dp,
    selectionMode: Boolean,
    isSelected: (Int) -> Boolean,
    onToggleSelection: (Int) -> Unit,
    onLongPress: (Int) -> Unit,
    onRequestDelete: (DownloadEntry) -> Unit,
    onNavigateToPlayer: (Int, String, Int, Int, String, String?, String?) -> Unit,
    onNavigateToDetail: (Int, String, Int, Int) -> Unit
) {
    if (entries.isEmpty()) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(top = topPadding)
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
                .fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, top = 16.dp + topPadding, end = 16.dp, bottom = 16.dp + LocalBottomBarPadding.current),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                GlassLargeTitle(title)
            }
            items(entries.sortedBy { it.season * 1000 + it.episode }, key = { it.id }) { entry ->
                val epDetail = viewModel.episodeDetails[Pair(entry.season, entry.episode)]
                EpisodeDownloadCard(
                    episodeNumber = entry.episode,
                    episodeName = epDetail?.name,
                    overview = epDetail?.overview,
                    stillPath = epDetail?.stillPath,
                    entry = entry,
                    selectionMode = selectionMode,
                    selected = isSelected(entry.id),
                    onToggleSelection = { onToggleSelection(entry.id) },
                    onLongPress = { onLongPress(entry.id) },
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
