package com.streamo.app.ui.anime

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items as rowItems
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.streamo.app.data.local.entity.ProgressEntry
import com.streamo.app.navigation.LocalBottomBarPadding
import com.streamo.app.navigation.LocalNavController
import com.streamo.app.navigation.NavRoutes
import com.streamo.app.provider.anime.AUAnime
import com.streamo.app.ui.common.BrandButton
import com.streamo.app.ui.common.GlassLargeTitle
import com.streamo.app.ui.common.GlassTopBarScaffold
import com.streamo.app.ui.common.LocalWindowSizeClass
import com.streamo.app.ui.common.MediaCard
import com.streamo.app.ui.common.ProgressMediaCard
import com.streamo.app.ui.common.SectionHeader
import com.streamo.app.ui.common.SkeletonCard
import com.streamo.app.ui.theme.AppShapes
import com.streamo.app.ui.common.cardWidth
import com.streamo.app.ui.common.contentPadding
import com.streamo.app.ui.common.itemSpacing

@Composable
fun AnimeScreen(
    onNavigateToDetail: (anime: AUAnime) -> Unit,
    viewModel: AnimeViewModel = hiltViewModel()
) {
    val windowSizeClass = LocalWindowSizeClass.current
    val continueRows by viewModel.continueRows.collectAsState()
    val navController = LocalNavController.current

    LaunchedEffect(Unit) { viewModel.loadIfNeeded() }

    GlassTopBarScaffold { topPadding ->
        val gridState = rememberLazyGridState()
        // Paginazione: carica la pagina successiva quando gli ultimi item sono visibili.
        val shouldLoadMore by remember {
            derivedStateOf {
                val last = gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1
                last >= viewModel.catalog.size - 4
            }
        }
        LaunchedEffect(shouldLoadMore) {
            if (shouldLoadMore) viewModel.loadMore()
        }

        Box(modifier = Modifier.fillMaxSize()) {
            if (viewModel.errorMessage != null && viewModel.catalog.isEmpty()) {
                AnimeErrorState(
                    message = viewModel.errorMessage!!,
                    onRetry = { viewModel.reload() },
                    modifier = Modifier.padding(top = topPadding)
                )
            } else {
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(minSize = windowSizeClass.cardWidth),
                    state = gridState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(
                        start = windowSizeClass.contentPadding,
                        top = 16.dp + topPadding,
                        end = windowSizeClass.contentPadding,
                        bottom = 16.dp + LocalBottomBarPadding.current
                    ),
                    horizontalArrangement = Arrangement.spacedBy(windowSizeClass.itemSpacing),
                    verticalArrangement = Arrangement.spacedBy(18.dp)
                ) {
                    // Riga "Continua a guardare" (anime) — span pieno.
                    if (continueRows.isNotEmpty()) {
                        item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) }) {
                            AnimeContinueRow(
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
                                },
                                onPlay = { entry ->
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
                                    }
                                }
                            )
                        }
                    }

                    // Header + campo ricerca.
                    item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) }) {
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            GlassLargeTitle("Anime")
                            AnimeSearchField(
                                query = viewModel.query,
                                onQueryChange = viewModel::onQueryChange
                            )
                            Spacer(Modifier.height(4.dp))
                        }
                    }

                    if (viewModel.catalog.isEmpty() && viewModel.isLoading) {
                        items(9) { SkeletonCard() }
                    } else if (viewModel.catalog.isEmpty() && viewModel.query.isNotBlank()) {
                        item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) }) {
                            Text(
                                text = "Nessun risultato.",
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 40.dp),
                                textAlign = TextAlign.Center,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    } else {
                        items(viewModel.catalog, key = { it.id }) { anime ->
                            AnimeCatalogCard(
                                anime = anime,
                                onClick = { onNavigateToDetail(anime) }
                            )
                        }
                        if (viewModel.isLoading && viewModel.catalog.isNotEmpty()) {
                            items(3) { SkeletonCard() }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AnimeSearchField(query: String, onQueryChange: (String) -> Unit) {
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        placeholder = { Text("Cerca anime") },
        leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null, tint = Color.White.copy(alpha = 0.6f)) },
        trailingIcon = {
            if (query.isNotEmpty()) {
                Icon(
                    imageVector = Icons.Filled.Clear,
                    contentDescription = "Cancella",
                    tint = Color.White.copy(alpha = 0.6f),
                    modifier = Modifier.clickable { onQueryChange("") }
                )
            }
        },
        singleLine = true,
        textStyle = TextStyle(color = Color.White, fontSize = 16.sp),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { /* live search, debounce gestito nel VM */ }),
        shape = AppShapes.lg,
        colors = TextFieldDefaults.colors(
            focusedContainerColor = Color.White.copy(alpha = 0.06f),
            unfocusedContainerColor = Color.White.copy(alpha = 0.06f),
            disabledContainerColor = Color.White.copy(alpha = 0.06f),
            focusedIndicatorColor = MaterialTheme.colorScheme.primary,
            unfocusedIndicatorColor = Color.White.copy(alpha = 0.12f)
        )
    )
}

@Composable
private fun AnimeContinueRow(
    entries: List<ProgressEntry>,
    onOpen: (ProgressEntry) -> Unit,
    onPlay: (ProgressEntry) -> Unit
) {
    val windowSizeClass = LocalWindowSizeClass.current
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionHeader(title = "Continua a guardare", icon = Icons.Filled.PlayCircle)
        LazyRow(
            contentPadding = PaddingValues(horizontal = windowSizeClass.contentPadding),
            horizontalArrangement = Arrangement.spacedBy(windowSizeClass.itemSpacing)
        ) {
            rowItems(entries) { entry ->
                ProgressMediaCard(
                    title = entry.title.ifBlank { "Anime ${entry.tmdbId}" },
                    // Poster AnimeUnity assoluto: niente TMDBImage.
                    posterUrl = entry.posterPath,
                    width = windowSizeClass.cardWidth,
                    aspectRatio = 2f / 3f,
                    // Niente badge S/E (anime = stagione 1 fittizia); l'episodio è nel titolo.
                    season = null,
                    episode = null,
                    positionSeconds = entry.positionSeconds,
                    durationSeconds = entry.durationSeconds,
                    showPlayButton = true,
                    onClick = { onOpen(entry) },
                    onPlay = { onPlay(entry) }
                )
            }
        }
    }
}

@Composable
private fun AnimeCatalogCard(anime: AUAnime, onClick: () -> Unit) {
    val windowSizeClass = LocalWindowSizeClass.current
    MediaCard(
        title = anime.displayTitle,
        // Poster AnimeUnity assoluto: niente TMDBImage.
        posterUrl = anime.imageurl,
        width = windowSizeClass.cardWidth,
        aspectRatio = 2f / 3f,
        year = anime.year,
        onClick = onClick,
        // Badge "ITA" per i doppiaggi — dentro il poster clippato (sfondo scuro
        // semitrasparente, regola CLAUDE.md). Era un sibling esterno → percepito fuori.
        overlayContent = {
            if (anime.isDubbed) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(6.dp)
                        .clip(AppShapes.xs)
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
    )
}

@Composable
private fun AnimeErrorState(message: String, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(
            text = "Catalogo non disponibile",
            style = MaterialTheme.typography.headlineSmall,
            color = MaterialTheme.colorScheme.onBackground
        )
        Text(
            text = message,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center
        )
        BrandButton(onClick = onRetry) { Text("Riprova") }
    }
}