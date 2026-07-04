package com.streamo.app.ui.settings

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.streamo.app.data.local.entity.DownloadEntry
import com.streamo.app.navigation.LocalBottomBarPadding
import com.streamo.app.ui.common.GlassAlertDialog
import com.streamo.app.ui.common.GlassCard
import com.streamo.app.ui.common.GlassDialogDestructiveButton
import com.streamo.app.ui.common.GlassDialogNeutralButton
import com.streamo.app.ui.common.GlassLargeTitle
import com.streamo.app.ui.common.GlassTopBarScaffold
import com.streamo.app.ui.common.LocalHazeState
import com.streamo.app.ui.common.LocalWindowSizeClass
import com.streamo.app.ui.common.contentPadding
import com.streamo.app.ui.downloads.PosterThumb
import com.streamo.app.ui.downloads.SelectionCheckbox
import com.streamo.app.ui.downloads.downloadItemLabel
import com.streamo.app.ui.downloads.formatBytes
import com.streamo.app.ui.downloads.statusColor
import com.streamo.app.ui.downloads.statusLabel

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun CacheManagementScreen(
    onBack: () -> Unit = {},
    viewModel: CacheManagementViewModel = hiltViewModel()
) {
    val windowSizeClass = LocalWindowSizeClass.current
    val entries by viewModel.entries.collectAsState(initial = emptyList())
    val streamingBytes by viewModel.streamingCacheBytes.collectAsState()
    val tmdbBytes by viewModel.tmdbCacheBytes.collectAsState()
    val tmdbCount by viewModel.tmdbCount.collectAsState()
    val imageBytes by viewModel.imageCacheBytes.collectAsState()
    val imageMaxBytes by viewModel.imageCacheMaxBytes.collectAsState()

    // Multi-select state, mirrored from the Downloads screen.
    var selectionMode by remember { mutableStateOf(false) }
    val selectedIds = remember { mutableStateListOf<Int>() }
    var confirmBulkDelete by remember { mutableStateOf(false) }

    fun exitSelection() {
        selectionMode = false
        selectedIds.clear()
    }

    LaunchedEffect(entries) {
        selectedIds.retainAll(entries.mapTo(HashSet()) { it.id })
        if (selectionMode && entries.isEmpty()) exitSelection()
    }

    BackHandler(enabled = selectionMode) { exitSelection() }

    var entryToDelete by remember { mutableStateOf<DownloadEntry?>(null) }
    var confirmClearStreaming by remember { mutableStateOf(false) }
    var confirmClearTmdb by remember { mutableStateOf(false) }
    var confirmClearImages by remember { mutableStateOf(false) }
    var confirmClearAll by remember { mutableStateOf(false) }

    val totalDownloadBytes = remember(entries) { entries.sumOf { it.bytesDownloaded } }

    GlassTopBarScaffold(
        onLeading = if (selectionMode) { { exitSelection() } } else onBack,
        leadingIcon = if (selectionMode) Icons.Filled.Close else Icons.AutoMirrored.Filled.ArrowBack,
        leadingDesc = if (selectionMode) "Annulla selezione" else "Indietro",
        actions = if (selectionMode) {
            {
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
            }
        } else null
    ) { topPadding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(
                start = windowSizeClass.contentPadding,
                top = 16.dp + topPadding,
                end = windowSizeClass.contentPadding,
                bottom = 16.dp + LocalBottomBarPadding.current
            ),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item {
                GlassLargeTitle(if (selectionMode) "${selectedIds.size} selezionati" else "Spazio e cache")
            }

            // ————————————————————————————
            // Svuota tutta la cache (master)
            // ————————————————————————————
            item {
                SectionHeader("Svuota tutto")
            }
            item {
                GlassCard(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            "Svuota tutta la cache",
                            style = MaterialTheme.typography.titleMedium
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            "Rimuove segmenti streaming, metadati TMDB e immagini. " +
                                "I download non sono toccati.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .combinedClickable(onClick = { confirmClearAll = true }),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = Icons.Filled.Delete,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.error,
                                modifier = Modifier.size(20.dp)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                "Svuota streaming, immagini e metadati",
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.error
                            )
                        }
                    }
                }
            }

            // ————————————————————————————
            // Cache metadati (TMDB) — offline browsing
            // ————————————————————————————
            item {
                SectionHeader("Cache metadati (TMDB)")
            }
            item {
                GlassCard(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("Dimensione", style = MaterialTheme.typography.titleMedium)
                            Text(
                                formatBytes(tmdbBytes),
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                        Spacer(modifier = Modifier.height(4.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("Voci", style = MaterialTheme.typography.bodyMedium)
                            Text(
                                "$tmdbCount",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            "Risposte TMDB su disco per navigare offline. Le voci scadono " +
                                "automaticamente (da 1 ora a 30 giorni secondo il tipo); con " +
                                "rete assente si usa la copia scaduta.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .combinedClickable(onClick = {
                                    if (tmdbBytes > 0L || tmdbCount > 0) confirmClearTmdb = true
                                }),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = Icons.Filled.Delete,
                                contentDescription = null,
                                tint = if (tmdbBytes > 0L || tmdbCount > 0) MaterialTheme.colorScheme.error
                                    else MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(20.dp)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                "Svuota cache metadati",
                                style = MaterialTheme.typography.bodyLarge,
                                color = if (tmdbBytes > 0L || tmdbCount > 0) MaterialTheme.colorScheme.error
                                    else MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }

            // ————————————————————————————
            // Cache immagini (Coil disk cache)
            // ————————————————————————————
            item {
                SectionHeader("Cache immagini")
            }
            item {
                GlassCard(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("Dimensione", style = MaterialTheme.typography.titleMedium)
                            Text(
                                "${formatBytes(imageBytes)} / ${formatBytes(imageMaxBytes)}",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            "Poster e backdrop TMDB su disco. Permette di vedere le immagini " +
                                "già caricate anche offline.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .combinedClickable(onClick = {
                                    if (imageBytes > 0L) confirmClearImages = true
                                }),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = Icons.Filled.Delete,
                                contentDescription = null,
                                tint = if (imageBytes > 0L) MaterialTheme.colorScheme.error
                                    else MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(20.dp)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                "Svuota cache immagini",
                                style = MaterialTheme.typography.bodyLarge,
                                color = if (imageBytes > 0L) MaterialTheme.colorScheme.error
                                    else MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }

            // ————————————————————————————
            // Cache streaming (playback LRU)
            // ————————————————————————————
            item {
                SectionHeader("Cache streaming")
            }
            item {
                GlassCard(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("Dimensione", style = MaterialTheme.typography.titleMedium)
                            Text(
                                formatBytes(streamingBytes),
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            "Segmenti temporanei della riproduzione online. Vengono conservati " +
                                "automaticamente fino a 300 MB (i più vecchi vengono rimossi). " +
                                "Puoi svuotare subito per recuperare spazio.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .combinedClickable(onClick = {
                                    if (streamingBytes > 0L) confirmClearStreaming = true
                                }),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = Icons.Filled.Delete,
                                contentDescription = null,
                                tint = if (streamingBytes > 0L) MaterialTheme.colorScheme.error
                                    else MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(20.dp)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                "Svuota cache streaming",
                                style = MaterialTheme.typography.bodyLarge,
                                color = if (streamingBytes > 0L) MaterialTheme.colorScheme.error
                                    else MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }

            // ————————————————————————————
            // Cache download (one row per download)
            // ————————————————————————————
            item {
                SectionHeader("Cache download")
            }
            if (entries.isEmpty()) {
                item {
                    Text(
                        text = "Nessun download.",
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 4.dp),
                        textAlign = TextAlign.Center,
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else {
                item {
                    GlassCard(modifier = Modifier.fillMaxWidth()) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(16.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("Totale download", style = MaterialTheme.typography.bodyLarge)
                            Text(
                                formatBytes(totalDownloadBytes),
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                    }
                }
                items(entries.sortedBy { it.id }, key = { it.id }) { entry ->
                    CacheDownloadRow(
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
                        onDelete = { entryToDelete = entry }
                    )
                }
            }
        }
    }

    // ————————————————————————————
    // Confirm dialogs
    // ————————————————————————————
    entryToDelete?.let { entry ->
        GlassAlertDialog(
            onDismissRequest = { entryToDelete = null },
            hazeState = LocalHazeState.current,
            title = "Elimina download",
            text = { Text("Vuoi eliminare il download di \"${entry.title}\"? Lo spazio verrà liberato.") },
            confirmButton = {
                GlassDialogDestructiveButton(
                    onClick = {
                        viewModel.remove(entry)
                        entryToDelete = null
                    }
                ) {
                    Text("Elimina")
                }
            },
            dismissButton = {
                GlassDialogNeutralButton(onClick = { entryToDelete = null }) { Text("Annulla") }
            }
        )
    }

    if (confirmBulkDelete) {
        val count = selectedIds.size
        GlassAlertDialog(
            onDismissRequest = { confirmBulkDelete = false },
            hazeState = LocalHazeState.current,
            title = "Elimina download",
            text = { Text("Vuoi eliminare $count download selezionati? Lo spazio verrà liberato.") },
            confirmButton = {
                GlassDialogDestructiveButton(
                    onClick = {
                        viewModel.removeMany(selectedIds.toList())
                        confirmBulkDelete = false
                        exitSelection()
                    }
                ) {
                    Text("Elimina")
                }
            },
            dismissButton = {
                GlassDialogNeutralButton(onClick = { confirmBulkDelete = false }) { Text("Annulla") }
            }
        )
    }

    if (confirmClearStreaming) {
        GlassAlertDialog(
            onDismissRequest = { confirmClearStreaming = false },
            hazeState = LocalHazeState.current,
            title = "Svuotare la cache streaming?",
            text = { Text("Verranno rimossi i segmenti della riproduzione online (${formatBytes(streamingBytes)}). I download non sono toccati.") },
            confirmButton = {
                GlassDialogDestructiveButton(
                    onClick = {
                        viewModel.clearStreamingCache()
                        confirmClearStreaming = false
                    }
                ) {
                    Text("Svuota")
                }
            },
            dismissButton = {
                GlassDialogNeutralButton(onClick = { confirmClearStreaming = false }) { Text("Annulla") }
            }
        )
    }

    if (confirmClearTmdb) {
        GlassAlertDialog(
            onDismissRequest = { confirmClearTmdb = false },
            hazeState = LocalHazeState.current,
            title = "Svuotare la cache metadati?",
            text = { Text("Verranno rimosse $tmdbCount voci TMDB (${formatBytes(tmdbBytes)}). Al primo accesso online verranno riscaricate.") },
            confirmButton = {
                GlassDialogDestructiveButton(
                    onClick = {
                        viewModel.clearTmdbCache()
                        confirmClearTmdb = false
                    }
                ) {
                    Text("Svuota")
                }
            },
            dismissButton = {
                GlassDialogNeutralButton(onClick = { confirmClearTmdb = false }) { Text("Annulla") }
            }
        )
    }

    if (confirmClearImages) {
        GlassAlertDialog(
            onDismissRequest = { confirmClearImages = false },
            hazeState = LocalHazeState.current,
            title = "Svuotare la cache immagini?",
            text = { Text("Verranno rimossi poster e backdrop (${formatBytes(imageBytes)}). Saranno riscaricati al prossimo caricamento.") },
            confirmButton = {
                GlassDialogDestructiveButton(
                    onClick = {
                        viewModel.clearImageCache()
                        confirmClearImages = false
                    }
                ) {
                    Text("Svuota")
                }
            },
            dismissButton = {
                GlassDialogNeutralButton(onClick = { confirmClearImages = false }) { Text("Annulla") }
            }
        )
    }

    if (confirmClearAll) {
        GlassAlertDialog(
            onDismissRequest = { confirmClearAll = false },
            hazeState = LocalHazeState.current,
            title = "Svuotare tutta la cache?",
            text = { Text("Verranno rimossi segmenti streaming (${formatBytes(streamingBytes)}), metadati TMDB (${formatBytes(tmdbBytes)}) e immagini (${formatBytes(imageBytes)}). I download non sono toccati.") },
            confirmButton = {
                GlassDialogDestructiveButton(
                    onClick = {
                        viewModel.clearAllCaches()
                        confirmClearAll = false
                    }
                ) {
                    Text("Svuota tutto")
                }
            },
            dismissButton = {
                GlassDialogNeutralButton(onClick = { confirmClearAll = false }) { Text("Annulla") }
            }
        )
    }
}

@Composable
private fun SectionHeader(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleMedium,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(start = 4.dp, top = 8.dp)
    )
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun CacheDownloadRow(
    entry: DownloadEntry,
    selectionMode: Boolean,
    selected: Boolean,
    onToggleSelection: () -> Unit,
    onLongPress: () -> Unit,
    onDelete: () -> Unit
) {
    GlassCard(
        modifier = Modifier
            .fillMaxWidth()
            .combinedClickable(
                onClick = { if (selectionMode) onToggleSelection() },
                onLongClick = onLongPress
            )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            PosterThumb(
                posterPath = entry.stillPath ?: entry.posterPath,
                modifier = Modifier.size(width = 48.dp, height = 72.dp)
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = downloadItemLabel(entry),
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = "${statusLabel(entry.status)} · ${formatBytes(entry.bytesDownloaded)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = statusColor(entry.status)
                )
            }
            SelectionCheckbox(
                selectionMode = selectionMode,
                selected = selected,
                onToggle = onToggleSelection
            )
            if (!selectionMode) {
                IconButton(
                    onClick = onDelete,
                    modifier = Modifier.size(40.dp)
                ) {
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