package com.streamo.app.ui.tv.anime

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.streamo.app.navigation.LocalNavController
import com.streamo.app.navigation.NavRoutes
import com.streamo.app.provider.anime.AUAnime
import com.streamo.app.ui.anime.AnimeViewModel
import com.streamo.app.ui.common.AmbientBackground
import com.streamo.app.ui.tv.common.TvFocusable
import com.streamo.app.ui.tv.common.TvMediaCard
import com.streamo.app.ui.tv.common.TvProgressMediaCard

/**
 * TV Anime: catalogo AnimeUnity con ricerca + "Continua a guardare", D-pad navigabile.
 * Riutilizza [AnimeViewModel] (logica identica al phone). Poster AnimeUnity assoluti.
 *
 * Tutto (continue + titolo + search + catalogo) vive in un unico [LazyVerticalGrid]
 * scorrevole, come il phone: la sezione "Continua a guardare" sta SOPRA la search bar
 * ma scorre via con la griglia, invece di restare pinned e rubare spazio / intrappolare
 * il focus D-pad sui risultati di ricerca.
 */
@Composable
fun TvAnimeScreen(
    onNavigateToDetail: (anime: AUAnime) -> Unit,
    viewModel: AnimeViewModel = hiltViewModel()
) {
    val continueRows by viewModel.continueRows.collectAsState()
    val navController = LocalNavController.current
    val searchFocusRequester = remember { FocusRequester() }
    val gridState = rememberLazyGridState()

    LaunchedEffect(Unit) {
        viewModel.loadIfNeeded()
        runCatching { searchFocusRequester.requestFocus() }
    }

    // Paginazione: carica la pagina successiva vicino al fondo.
    val shouldLoadMore by remember {
        derivedStateOf {
            val last = gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1
            last >= viewModel.catalog.size - 4
        }
    }
    LaunchedEffect(shouldLoadMore) {
        if (shouldLoadMore) viewModel.loadMore()
    }

    AmbientBackground()

    Box(modifier = Modifier.fillMaxSize()) {
        LazyVerticalGrid(
            columns = GridCells.Fixed(5),
            state = gridState,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 48.dp, vertical = 24.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp)
        ) {
            // "Continua a guardare" (anime) — span pieno, SOPRA la search bar (come il phone).
            if (continueRows.isNotEmpty()) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    TvAnimeContinueRow(
                        entries = continueRows,
                        onOpen = { entry ->
                            val target = viewModel.continueEntry(entry)
                            if (target != null) {
                                navController.navigate(
                                    NavRoutes.Player(
                                        tmdbId = target.animeId,
                                        mediaType = "anime",
                                        resumeSeason = 1,
                                        resumeEpisode = target.episode,
                                        title = target.title ?: "",
                                        poster = target.poster,
                                        releaseDate = null,
                                        animeEpisodeId = target.episodeId,
                                        animeSlug = target.slug
                                    )
                                )
                            } else {
                                onNavigateToDetail(
                                    AUAnime.stub(
                                        id = entry.tmdbId,
                                        title = entry.title,
                                        slug = entry.providerSlug,
                                        imageurl = entry.posterPath
                                    )
                                )
                            }
                        }
                    )
                }
            }

            // Titolo + campo ricerca — span pieno.
            item(span = { GridItemSpan(maxLineSpan) }) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        text = "Anime",
                        style = MaterialTheme.typography.headlineSmall,
                        color = Color.White
                    )
                    OutlinedTextField(
                        value = viewModel.query,
                        onValueChange = { viewModel.onQueryChange(it) },
                        label = { Text("Cerca anime") },
                        singleLine = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .focusRequester(searchFocusRequester)
                    )
                }
            }

            if (viewModel.errorMessage != null && viewModel.catalog.isEmpty()) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(32.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Text(
                            "Catalogo non disponibile",
                            color = Color.White,
                            style = MaterialTheme.typography.titleMedium
                        )
                        Text(
                            viewModel.errorMessage!!,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center
                        )
                        TvFocusable(onClick = { viewModel.reload() }) { focused ->
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(
                                        if (focused) MaterialTheme.colorScheme.primary
                                        else MaterialTheme.colorScheme.primary.copy(alpha = 0.7f)
                                    )
                                    .padding(horizontal = 24.dp, vertical = 12.dp)
                            ) {
                                Text("Riprova", color = Color.White)
                            }
                        }
                    }
                }
            } else if (viewModel.catalog.isEmpty() && viewModel.isLoading) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Box(
                        modifier = Modifier.fillMaxWidth().padding(24.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator()
                    }
                }
            } else if (viewModel.catalog.isEmpty() && viewModel.query.isNotBlank()) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Text(
                        "Nessun risultato.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.fillMaxWidth().padding(vertical = 32.dp),
                        textAlign = TextAlign.Center
                    )
                }
            } else {
                items(viewModel.catalog, key = { it.id }) { anime ->
                    TvAnimeCatalogCard(
                        anime = anime,
                        onClick = { onNavigateToDetail(anime) }
                    )
                }
                if (viewModel.isLoading && viewModel.catalog.isNotEmpty()) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Box(
                            modifier = Modifier.fillMaxWidth().padding(16.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            CircularProgressIndicator()
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TvAnimeContinueRow(
    entries: List<com.streamo.app.data.local.entity.ProgressEntry>,
    onOpen: (com.streamo.app.data.local.entity.ProgressEntry) -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            "Continua a guardare",
            style = MaterialTheme.typography.titleMedium,
            color = Color.White
        )
        LazyRow(
            contentPadding = PaddingValues(vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            items(entries) { entry ->
                TvProgressMediaCard(
                    title = entry.title.ifBlank { "Anime ${entry.tmdbId}" },
                    posterUrl = entry.posterPath,
                    width = 140.dp,
                    aspectRatio = 2f / 3f,
                    season = null,
                    episode = null,
                    positionSeconds = entry.positionSeconds,
                    durationSeconds = entry.durationSeconds,
                    onClick = { onOpen(entry) }
                )
            }
        }
    }
}

@Composable
private fun TvAnimeCatalogCard(anime: AUAnime, onClick: () -> Unit) {
    Box {
        TvMediaCard(
            title = anime.displayTitle,
            posterUrl = anime.imageurl,
            width = 140.dp,
            aspectRatio = 2f / 3f,
            onClick = onClick
        )
        // Badge "ITA" per i doppiaggi — sfondo scuro semitrasparente (regola CLAUDE.md).
        if (anime.isDubbed) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(6.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(Color.Black.copy(alpha = 0.55f))
                    .padding(horizontal = 6.dp, vertical = 2.dp)
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