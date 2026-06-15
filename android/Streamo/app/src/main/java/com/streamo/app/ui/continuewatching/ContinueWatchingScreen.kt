package com.streamo.app.ui.continuewatching

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.streamo.app.data.local.entity.ProgressEntry
import com.streamo.app.navigation.LocalBottomBarPadding
import com.streamo.app.tmdb.TMDBImage
import androidx.compose.foundation.lazy.grid.GridItemSpan
import com.streamo.app.ui.common.GlassLargeTitle
import com.streamo.app.ui.common.GlassTopBarScaffold
import com.streamo.app.ui.common.ProgressMediaCard

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContinueWatchingScreen(
    onNavigateToDetail: (Int, String, Int, Int) -> Unit = { _, _, _, _ -> },
    onNavigateToPlayer: (Int, String, Int, Int, String, String?, String?) -> Unit = { _, _, _, _, _, _, _ -> },
    onBack: () -> Unit = {},
    viewModel: ContinueWatchingViewModel = hiltViewModel()
) {
    val items by viewModel.items.collectAsState()
    var showRemoveDialog by remember { mutableStateOf(false) }
    var entryToRemove by remember { mutableStateOf<ProgressEntry?>(null) }

    GlassTopBarScaffold(
        onLeading = onBack
    ) { topPadding ->
        if (items.isEmpty()) {
            Text(
                text = "Nessun elemento in corso.",
                modifier = Modifier
                    .fillMaxSize()
                    .padding(top = topPadding)
                    .padding(24.dp),
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        } else {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 140.dp),
                modifier = Modifier
                    .fillMaxSize(),
                contentPadding = PaddingValues(start = 16.dp, top = 16.dp + topPadding, end = 16.dp, bottom = 16.dp + LocalBottomBarPadding.current),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp)
            ) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    GlassLargeTitle("Continua a guardare")
                }
                items(items) { entry ->
                    ProgressMediaCard(
                        title = entry.title.ifBlank { "${entry.tmdbId} S${entry.season}:E${entry.episode}" },
                        posterUrl = entry.posterPath?.let { TMDBImage.url(it, TMDBImage.Size.W500) },
                        season = entry.season.takeIf { entry.mediaType == "tv" && it > 0 },
                        episode = entry.episode.takeIf { entry.mediaType == "tv" && it > 0 },
                        positionSeconds = entry.positionSeconds,
                        durationSeconds = entry.durationSeconds,
                        showPlayButton = true,
                        onClick = { onNavigateToDetail(entry.tmdbId, entry.mediaType, entry.season, entry.episode) },
                        onPlay = {
                            onNavigateToPlayer(
                                entry.tmdbId,
                                entry.mediaType,
                                entry.season,
                                entry.episode,
                                entry.title.ifBlank { "${entry.tmdbId} S${entry.season}:E${entry.episode}" },
                                entry.posterPath,
                                null
                            )
                        },
                        onRemove = {
                            entryToRemove = entry
                            showRemoveDialog = true
                        }
                    )
                }
            }
        }

        if (showRemoveDialog && entryToRemove != null) {
            val entry = entryToRemove!!
            AlertDialog(
                onDismissRequest = {
                    showRemoveDialog = false
                    entryToRemove = null
                },
                title = { Text("Rimuovi") },
                text = {
                    Text(
                        "Rimuovere \"${entry.title.ifBlank { "${entry.tmdbId}" }}\" dalla lista?"
                    )
                },
                confirmButton = {
                    TextButton(
                        onClick = {
                            viewModel.remove(entry.tmdbId)
                            showRemoveDialog = false
                            entryToRemove = null
                        }
                    ) {
                        Text("Rimuovi", color = MaterialTheme.colorScheme.error)
                    }
                },
                dismissButton = {
                    TextButton(
                        onClick = {
                            showRemoveDialog = false
                            entryToRemove = null
                        }
                    ) {
                        Text("Annulla", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            )
        }
    }
}
