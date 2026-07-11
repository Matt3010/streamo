package com.streamo.app.ui.tv.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.compose.currentBackStackEntryAsState
import com.streamo.app.data.local.entity.ProgressEntry
import com.streamo.app.data.local.entity.WatchlistEntry
import com.streamo.app.navigation.LocalNavController
import com.streamo.app.navigation.NavRoutes
import com.streamo.app.tmdb.TMDBImage
import com.streamo.app.ui.common.AmbientBackground
import com.streamo.app.ui.home.HomeSections
import com.streamo.app.ui.home.HomeViewModel
import com.streamo.app.ui.tv.common.TvImmersiveRow
import com.streamo.app.ui.tv.common.TvLoadMoreCard
import com.streamo.app.ui.tv.common.TvMediaCard
import com.streamo.app.ui.tv.common.TvProgressMediaCard
import com.streamo.app.ui.tv.common.TvSectionRow
import com.streamo.app.ui.tv.common.TV_HOME_ROW_LIMIT
import kotlinx.coroutines.delay

/**
 * TV Home screen. Vertical list of immersive rows:
 * Continue Watching + My List (folded in) + catalog sections.
 * No PullToRefresh (D-pad); load in LaunchedEffect, retry via focusable button.
 * Initial focus lands on the first card of the first visible row; on return from
 * Detail it lands on the card that was clicked (resumeFocusKey, rememberSaveable).
 */
@Composable
fun TvHomeScreen(
    onNavigateToDetail: (Int, String, Int, Int) -> Unit = { _, _, _, _ -> },
    onNavigateToSectionList: (String, String, String) -> Unit = { _, _, _ -> },
    onNavigateToContinueWatching: () -> Unit = {},
    onNavigateToWatchlist: () -> Unit = {},
    onNavigateToPlayer: (Int, String, Int, Int, String, String?, String?) -> Unit = { _, _, _, _, _, _, _ -> },
    viewModel: HomeViewModel = hiltViewModel()
) {
    val watchlist by viewModel.watchlist.collectAsState()
    val progress by viewModel.progress.collectAsState()
    val initialCardFocus = remember { FocusRequester() }
    var resumeFocusKey by rememberSaveable { mutableStateOf<String?>(null) }
    val navBackStackEntry by LocalNavController.current.currentBackStackEntryAsState()
    val isHome = navBackStackEntry?.destination?.hasRoute(NavRoutes.Home::class) == true

    LaunchedEffect(Unit) { viewModel.loadIfNeeded() }

    // Focus target: the last clicked card if still visible (return from Detail),
    // otherwise the first card of the first non-empty row. The requester is attached
    // to exactly one real card via focusKey — never to a container.
    val firstSection = HomeSections.all.firstOrNull()
    val defaultFocusKey = when {
        progress.isNotEmpty() -> cwFocusKey(progress.first())
        watchlist.isNotEmpty() -> mlFocusKey(watchlist.first())
        else -> firstSection?.let { s ->
            viewModel.itemsFor(s).firstOrNull()?.let { secFocusKey(s.id, it.id) }
        }
    }
    val resumeKey = resumeFocusKey
    val resumeVisible = resumeKey != null && when {
        resumeKey.startsWith("cw:") -> progress.take(TV_HOME_ROW_LIMIT).any { cwFocusKey(it) == resumeKey }
        resumeKey.startsWith("ml:") -> watchlist.take(TV_HOME_ROW_LIMIT).any { mlFocusKey(it) == resumeKey }
        else -> HomeSections.all.any { s ->
            resumeKey.startsWith("sec:${s.id}:") &&
                viewModel.itemsFor(s).take(TV_HOME_ROW_LIMIT).any { secFocusKey(s.id, it.id) == resumeKey }
        }
    }
    val focusKey = when {
        resumeKey == null -> defaultFocusKey
        resumeVisible -> resumeKey
        else -> null // clicked card no longer visible: leave focus where the root put it
    }
    // Keyed on presence, not value: a Continue Watching reorder changes the default
    // key but must NOT steal focus from wherever the user currently is.
    LaunchedEffect(isHome, focusKey != null) {
        if (isHome && focusKey != null) repeat(60) {
            if (runCatching { initialCardFocus.requestFocus() }.getOrDefault(false)) {
                return@LaunchedEffect
            }
            delay(16)
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        AmbientBackground()

        if (viewModel.errorMessage != null && viewModel.rows.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Text(
                        text = "Catalogo non disponibile",
                        style = MaterialTheme.typography.headlineSmall,
                        color = MaterialTheme.colorScheme.onBackground
                    )
                    Text(
                        text = viewModel.errorMessage!!,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 40.dp)
                    )
                    Button(onClick = { viewModel.reload() }) {
                        Text("Riprova")
                    }
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(24.dp)
            ) {
                if (progress.isNotEmpty()) {
                    item {
                        TvContinueWatchingRow(
                            entries = progress,
                            onNavigateToDetail = { tmdbId, mediaType, season, episode ->
                                resumeFocusKey = "cw:$tmdbId:$mediaType"
                                onNavigateToDetail(tmdbId, mediaType, season, episode)
                            },
                            onMoreClick = onNavigateToContinueWatching,
                            focusKey = focusKey,
                            focusRequester = initialCardFocus
                        )
                    }
                }

                if (watchlist.isNotEmpty()) {
                    item {
                        TvMyListRow(
                            entries = watchlist,
                            onNavigateToDetail = { tmdbId, mediaType, season, episode ->
                                resumeFocusKey = "ml:$tmdbId:$mediaType"
                                onNavigateToDetail(tmdbId, mediaType, season, episode)
                            },
                            onMoreClick = onNavigateToWatchlist,
                            focusKey = focusKey,
                            focusRequester = initialCardFocus
                        )
                    }
                }

                items(HomeSections.all) { section ->
                    TvSectionRow(
                        section = section,
                        items = viewModel.itemsFor(section),
                        loading = viewModel.isLoading,
                        onItemClick = { item ->
                            resumeFocusKey = secFocusKey(section.id, item.id)
                            onNavigateToDetail(item.id, section.mediaType, 0, 0)
                        },
                        onMoreClick = {
                            onNavigateToSectionList(section.title, section.endpoint, section.mediaType)
                        },
                        focusRequester = initialCardFocus,
                        focusItemId = focusKey?.takeIf { it.startsWith("sec:${section.id}:") }
                            ?.substringAfterLast(':')?.toIntOrNull()
                    )
                }
            }
        }
    }
}

@Composable
private fun TvContinueWatchingRow(
    entries: List<ProgressEntry>,
    onNavigateToDetail: (Int, String, Int, Int) -> Unit,
    onMoreClick: () -> Unit,
    focusKey: String?,
    focusRequester: FocusRequester
) {
    val visibleEntries = entries.take(TV_HOME_ROW_LIMIT)

    TvImmersiveRow(title = "Continua a guardare", icon = Icons.Filled.PlayCircle) {
        // La lista è già raggruppata per (tmdbId, mediaType) e ordinata per updatedAt:
        // chiave stabile per titolo, così un riordino o l'avanzamento di episodio
        // non ricreano (né sfocano) la card focalizzata.
        items(
            visibleEntries,
            key = { "${it.tmdbId}:${it.mediaType}" }
        ) { entry ->
            TvProgressMediaCard(
                title = entry.title.ifBlank { "${entry.tmdbId} S${entry.season}:E${entry.episode}" },
                posterUrl = entry.posterPath?.let { TMDBImage.url(it, TMDBImage.Size.W500) },
                season = entry.season.takeIf { entry.mediaType == "tv" && it > 0 },
                episode = entry.episode.takeIf { entry.mediaType == "tv" && it > 0 },
                positionSeconds = entry.positionSeconds,
                durationSeconds = entry.durationSeconds,
                focusRequester = focusRequester.takeIf { cwFocusKey(entry) == focusKey },
                onClick = {
                    onNavigateToDetail(entry.tmdbId, entry.mediaType, entry.season, entry.episode)
                }
            )
        }
        if (entries.size > visibleEntries.size) {
            item { TvLoadMoreCard(onClick = onMoreClick) }
        }
    }
}

@Composable
private fun TvMyListRow(
    entries: List<WatchlistEntry>,
    onNavigateToDetail: (Int, String, Int, Int) -> Unit,
    onMoreClick: () -> Unit,
    focusKey: String?,
    focusRequester: FocusRequester
) {
    val visibleEntries = entries.take(TV_HOME_ROW_LIMIT)

    TvImmersiveRow(title = "La mia lista", icon = Icons.Filled.Bookmark) {
        items(
            visibleEntries,
            key = { "${it.tmdbId}:${it.mediaType}" }
        ) { entry ->
            TvMediaCard(
                title = entry.title,
                posterUrl = entry.posterPath?.let { TMDBImage.url(it, TMDBImage.Size.W500) },
                focusRequester = focusRequester.takeIf { mlFocusKey(entry) == focusKey },
                onClick = { onNavigateToDetail(entry.tmdbId, entry.mediaType, 0, 0) }
            )
        }
        if (entries.size > visibleEntries.size) {
            item { TvLoadMoreCard(onClick = onMoreClick) }
        }
    }
}

// Chiavi (rememberSaveable-friendly) per il ripristino del focus al ritorno da Dettaglio.
private fun cwFocusKey(entry: ProgressEntry) = "cw:${entry.tmdbId}:${entry.mediaType}"
private fun mlFocusKey(entry: WatchlistEntry) = "ml:${entry.tmdbId}:${entry.mediaType}"
private fun secFocusKey(sectionId: String, itemId: Int) = "sec:$sectionId:$itemId"
