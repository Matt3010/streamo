package com.streamo.app.ui.downloads

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.AlertDialog
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage
import com.streamo.app.data.local.entity.DownloadEntry
import com.streamo.app.tmdb.TMDBImage
import com.streamo.app.ui.common.ImagePlaceholder

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DownloadsScreen(
    onNavigateToDetail: (Int, String, Int, Int) -> Unit = { _, _, _, _ -> },
    onNavigateToPlayer: (Int, String, Int, Int, String, String?, String?) -> Unit = { _, _, _, _, _, _, _ -> },
    onNavigateToSeriesDownloads: (Int, String) -> Unit = { _, _ -> },
    viewModel: DownloadsViewModel = hiltViewModel()
) {
    val entries by viewModel.entries.collectAsState(initial = emptyList())

    // Multi-select state: set of selected DownloadEntry ids (a series group selects all its ids).
    var selectionMode by remember { mutableStateOf(false) }
    val selectedIds = remember { mutableStateListOf<Int>() }
    var confirmBulkDelete by remember { mutableStateOf(false) }

    fun exitSelection() {
        selectionMode = false
        selectedIds.clear()
    }

    // Prune ids that no longer exist (e.g. after a download finishes/disappears).
    LaunchedEffect(entries) {
        selectedIds.retainAll(entries.mapTo(HashSet()) { it.id })
        if (selectionMode && entries.isEmpty()) exitSelection()
    }

    BackHandler(enabled = selectionMode) { exitSelection() }

    Scaffold(
        contentWindowInsets = androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0),
        topBar = {
            if (selectionMode) {
                TopAppBar(
                    title = {
                        Text(
                            "${selectedIds.size} selezionati",
                            style = MaterialTheme.typography.titleLarge
                        )
                    },
                    navigationIcon = {
                        IconButton(onClick = { exitSelection() }) {
                            Icon(
                                imageVector = Icons.Filled.Close,
                                contentDescription = "Annulla selezione"
                            )
                        }
                    },
                    actions = {
                        val allIds = entries.map { it.id }
                        val allSelected = allIds.isNotEmpty() && allIds.all { it in selectedIds }
                        Text(
                            "Tutti",
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Checkbox(
                            checked = allSelected,
                            onCheckedChange = {
                                selectedIds.clear()
                                if (!allSelected) selectedIds.addAll(allIds)
                            }
                        )
                        IconButton(
                            onClick = { confirmBulkDelete = true },
                            enabled = selectedIds.isNotEmpty()
                        ) {
                            Icon(
                                imageVector = Icons.Filled.Delete,
                                contentDescription = "Elimina selezionati",
                                tint = if (selectedIds.isNotEmpty()) MaterialTheme.colorScheme.error
                                    else MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.colorScheme.background,
                        scrolledContainerColor = MaterialTheme.colorScheme.background,
                        titleContentColor = MaterialTheme.colorScheme.onBackground
                    )
                )
            } else {
                TopAppBar(
                    title = {
                        Text(
                            "Download",
                            style = MaterialTheme.typography.titleLarge
                        )
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.colorScheme.background,
                        scrolledContainerColor = MaterialTheme.colorScheme.background,
                        titleContentColor = MaterialTheme.colorScheme.onBackground
                    )
                )
            }
        }
    ) { paddingValues ->
        var entryToDelete by remember { mutableStateOf<DownloadEntry?>(null) }

        if (entries.isEmpty()) {
            Text(
                text = "Nessun download.",
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
                    .padding(24.dp),
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        } else {
            // Film come righe singole, serie TV raggruppate per tmdbId.
            val movies = remember(entries) {
                entries.filter { it.mediaType != "tv" }.sortedBy { it.id }
            }
            val tvGroups = remember(entries) {
                entries.filter { it.mediaType == "tv" }
                    .groupBy { it.tmdbId }
                    .map { (_, group) -> group.sortedWith(compareBy({ it.season }, { it.episode })) }
                    .sortedBy { it.first().id }
            }
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                items(movies, key = { it.id }) { entry ->
                    DownloadManagerRow(
                        entry = entry,
                        selectionMode = selectionMode,
                        selected = entry.id in selectedIds,
                        onToggleSelection = {
                            if (entry.id in selectedIds) selectedIds.remove(entry.id)
                            else selectedIds.add(entry.id)
                        },
                        onLongPress = {
                            if (!selectionMode) {
                                selectionMode = true
                                selectedIds.add(entry.id)
                            }
                        },
                        onStop = { viewModel.stop(entry) },
                        onRestart = { viewModel.restart(entry) },
                        onDelete = { entryToDelete = entry }
                    )
                }
                tvGroups.forEach { group ->
                    val head = group.first()
                    val groupIds = group.map { it.id }
                    item(key = "series_${head.tmdbId}") {
                        SeriesDownloadGroupRow(
                            entries = group,
                            selectionMode = selectionMode,
                            selected = groupIds.all { it in selectedIds },
                            onToggleSelection = {
                                if (groupIds.all { it in selectedIds }) selectedIds.removeAll(groupIds)
                                else { selectedIds.removeAll(groupIds); selectedIds.addAll(groupIds) }
                            },
                            onLongPress = {
                                if (!selectionMode) {
                                    selectionMode = true
                                    selectedIds.addAll(groupIds)
                                }
                            },
                            onClick = { onNavigateToSeriesDownloads(head.tmdbId, head.title) }
                        )
                    }
                }
            }
        }

        // Confirm delete dialog
        entryToDelete?.let { entry ->
            AlertDialog(
                onDismissRequest = { entryToDelete = null },
                title = { Text("Elimina download") },
                text = { Text("Vuoi eliminare il download di \"${entry.title}\"?") },
                confirmButton = {
                    TextButton(
                        onClick = {
                            viewModel.remove(entry)
                            entryToDelete = null
                        }
                    ) {
                        Text("Elimina", color = MaterialTheme.colorScheme.error)
                    }
                },
                dismissButton = {
                    TextButton(onClick = { entryToDelete = null }) {
                        Text("Annulla", color = MaterialTheme.colorScheme.onSurface)
                    }
                }
            )
        }

        // Confirm bulk delete dialog (multi-select)
        if (confirmBulkDelete) {
            val count = selectedIds.size
            AlertDialog(
                onDismissRequest = { confirmBulkDelete = false },
                title = { Text("Elimina download") },
                text = { Text("Vuoi eliminare $count download selezionati?") },
                confirmButton = {
                    TextButton(
                        onClick = {
                            viewModel.removeMany(selectedIds.toList())
                            confirmBulkDelete = false
                            exitSelection()
                        }
                    ) {
                        Text("Elimina", color = MaterialTheme.colorScheme.error)
                    }
                },
                dismissButton = {
                    TextButton(onClick = { confirmBulkDelete = false }) {
                        Text("Annulla", color = MaterialTheme.colorScheme.onSurface)
                    }
                }
            )
        }
    }
}

/** Etichetta piatta: "S1 Episodio 3 - Titolo" per le serie, solo titolo per i film. */
internal fun downloadItemLabel(entry: DownloadEntry): String =
    if (entry.mediaType == "tv" && entry.season > 0) {
        "S${entry.season} Episodio ${entry.episode} - ${entry.title}"
    } else {
        entry.title
    }

/**
 * Riga manager-style: titolo, descrizione (stagione-episodio-nome per TV, anno per film),
 * stato, progress bar + dettaglio, bottoni stop (active), resume (paused), delete (sempre).
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun DownloadManagerRow(
    entry: DownloadEntry,
    selectionMode: Boolean,
    selected: Boolean,
    onToggleSelection: () -> Unit,
    onLongPress: () -> Unit,
    onStop: () -> Unit,
    onRestart: () -> Unit,
    onDelete: () -> Unit
) {
    val status = entry.status
    val isActive = status == "downloading" || status == "pending" || status == "resolving"
    val isPaused = status == "paused"
    val isFailed = status == "failed"
    val isCompleted = status == "completed"
    val showProgress = isActive || isPaused
    val progress = entry.downloadPercentage

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .combinedClickable(
                onClick = { if (selectionMode) onToggleSelection() },
                onLongClick = onLongPress
            ),
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
                PosterThumb(
                    posterPath = entry.stillPath ?: entry.posterPath,
                    modifier = Modifier.size(width = 48.dp, height = 72.dp)
                )
                Spacer(modifier = Modifier.size(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = entry.title,
                        style = MaterialTheme.typography.bodyLarge,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                    if (entry.mediaType == "tv" && entry.season > 0) {
                        val epLabel = if (entry.episode > 0) {
                            "Stagione ${entry.season} · Episodio ${entry.episode}"
                        } else {
                            "Stagione ${entry.season}"
                        }
                        Text(
                            text = epLabel,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                    Text(
                        text = statusLabel(status),
                        style = MaterialTheme.typography.bodySmall,
                        color = statusColor(status)
                    )
                    if (showProgress) {
                        Spacer(modifier = Modifier.height(4.dp))
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
                        val detail = downloadDetailLine(
                            progress,
                            entry.bytesDownloaded,
                            entry.bytesTotal,
                            entry.bytesPerSecond
                        )
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
                        IconButton(onClick = onDelete, modifier = Modifier.size(40.dp)) {
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
    }
}

internal fun statusLabel(status: String): String = when (status) {
    "pending" -> "In attesa"
    "resolving" -> "Risoluzione URL..."
    "downloading" -> "Download in corso..."
    "paused" -> "In pausa"
    "completed" -> "Completato"
    "failed" -> "Errore"
    else -> status
}

internal fun formatBytes(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val kb = bytes / 1024.0
    if (kb < 1024) return "%.1f KB".format(kb)
    val mb = kb / 1024.0
    if (mb < 1024) return "%.1f MB".format(mb)
    val gb = mb / 1024.0
    return "%.1f GB".format(gb)
}

internal fun formatSpeed(bytesPerSecond: Long): String =
    if (bytesPerSecond <= 0) "" else "${formatBytes(bytesPerSecond)}/s"

/**
 * Riga riepilogo download: "42% · 120 MB / 300 MB · 5.0 MB/s".
 * Pezzi assenti (totale o velocità sconosciuti) vengono omessi.
 */
internal fun downloadDetailLine(
    percentage: Float,
    bytesDownloaded: Long,
    bytesTotal: Long,
    bytesPerSecond: Long
): String {
    val parts = mutableListOf<String>()
    if (percentage > 0f) parts += "${percentage.toInt()}%"
    if (bytesDownloaded > 0) {
        parts += if (bytesTotal > 0) {
            "${formatBytes(bytesDownloaded)} / ${formatBytes(bytesTotal)}"
        } else {
            "${formatBytes(bytesDownloaded)} scaricati"
        }
    }
    formatSpeed(bytesPerSecond).takeIf { it.isNotEmpty() }?.let { parts += it }
    return parts.joinToString(" · ")
}

@Composable
internal fun statusColor(status: String) = when (status) {
    "completed" -> MaterialTheme.colorScheme.primary
    else -> MaterialTheme.colorScheme.onSurfaceVariant
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun SeriesDownloadGroupRow(
    entries: List<DownloadEntry>,
    selectionMode: Boolean,
    selected: Boolean,
    onToggleSelection: () -> Unit,
    onLongPress: () -> Unit,
    onClick: () -> Unit
) {
    val head = entries.first()
    val total = entries.size
    val completed = entries.count { it.status == "completed" }
    val active = entries.count {
        it.status == "downloading" || it.status == "pending" || it.status == "resolving" || it.status == "paused"
    }
    val failed = entries.count { it.status == "failed" }

    val subtitle = buildString {
        append("$total episodi")
        if (completed > 0) append(" · $completed completati")
        if (active > 0) append(" · $active in corso")
        if (failed > 0) append(" · $failed errore")
    }

    val aggregateProgress: Float? = if (active > 0) {
        val activeEntries = entries.filter {
            it.status == "downloading" || it.status == "pending" || it.status == "resolving" || it.status == "paused"
        }
        if (activeEntries.any { it.downloadPercentage > 0f }) {
            activeEntries.map { it.downloadPercentage }.average().toFloat().coerceIn(0f, 100f)
        } else 0f
    } else null

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .combinedClickable(
                onClick = { if (selectionMode) onToggleSelection() else onClick() },
                onLongClick = onLongPress
            ),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            PosterThumb(head.posterPath, Modifier.size(width = 48.dp, height = 72.dp))
            Spacer(modifier = Modifier.size(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = head.title,
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                if (aggregateProgress != null) {
                    Spacer(modifier = Modifier.height(6.dp))
                    if (aggregateProgress > 0f) {
                        LinearProgressIndicator(
                            progress = { (aggregateProgress / 100f).coerceIn(0f, 1f) },
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
            }
            Spacer(modifier = Modifier.size(8.dp))
            if (selectionMode) {
                SelectionCheckbox(
                    selectionMode = true,
                    selected = selected,
                    onToggle = onToggleSelection
                )
            } else {
                Icon(
                    imageVector = Icons.Filled.ChevronRight,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

/** Checkbox a destra di ogni item che entra/esce animato in modalità selezione. */
@Composable
internal fun SelectionCheckbox(
    selectionMode: Boolean,
    selected: Boolean,
    onToggle: () -> Unit
) {
    AnimatedVisibility(
        visible = selectionMode,
        enter = fadeIn() + expandHorizontally(),
        exit = fadeOut() + shrinkHorizontally()
    ) {
        Checkbox(
            checked = selected,
            onCheckedChange = { onToggle() }
        )
    }
}

@Composable
internal fun PosterThumb(posterPath: String?, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(8.dp)
    if (posterPath.isNullOrBlank()) {
        ImagePlaceholder(
            label = "",
            showLabel = false,
            iconSizeDp = 32.dp,
            modifier = modifier.clip(shape)
        )
    } else {
        AsyncImage(
            model = TMDBImage.url(posterPath, TMDBImage.Size.W185),
            contentDescription = null,
            modifier = modifier
                .clip(shape)
                .background(MaterialTheme.colorScheme.surface),
            contentScale = ContentScale.Crop
        )
    }
}