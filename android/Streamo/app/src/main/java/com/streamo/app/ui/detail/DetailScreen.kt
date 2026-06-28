package com.streamo.app.ui.detail

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.BookmarkBorder
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SmartDisplay
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.ThumbUp
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
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.util.lerp
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage
import com.streamo.app.navigation.LocalBottomBarPadding
import com.streamo.app.navigation.LocalNavController
import com.streamo.app.navigation.NavRoutes
import com.streamo.app.ui.detail.ProviderAvailability
import com.streamo.app.ui.downloads.DownloadQualityDialog
import com.streamo.app.data.remote.dto.TmdbEpisodeDetail
import com.streamo.app.data.remote.dto.TmdbItem
import com.streamo.app.data.remote.dto.TmdbReview
import com.streamo.app.tmdb.TMDBImage
import com.streamo.app.ui.common.BrandButton
import com.streamo.app.ui.common.BrandIconButton
import com.streamo.app.ui.common.GlassAlertDialog
import com.streamo.app.ui.common.GlassDialog
import com.streamo.app.ui.common.GlassDialogNeutralButton
import com.streamo.app.ui.common.GlassDialogPrimaryButton
import com.streamo.app.ui.common.GlassTopBar
import com.streamo.app.ui.common.LocalHazeState
import androidx.compose.material3.TextButton
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.hazeSource
import com.streamo.app.ui.common.BrandSecondaryButton
import com.streamo.app.ui.common.MediaCard
import com.streamo.app.ui.common.SeasonChip
import com.streamo.app.ui.common.SectionHeader
import com.streamo.app.ui.common.ImagePlaceholder
import com.streamo.app.util.Format
import com.streamo.app.util.TVLogic
import com.streamo.app.ui.common.LocalWindowSizeClass
import com.streamo.app.ui.common.contentPadding
import com.streamo.app.ui.common.isLandscapeTablet
import androidx.browser.customtabs.CustomTabsIntent
import android.content.res.Configuration
import android.net.Uri
import android.widget.Toast
import java.text.SimpleDateFormat
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DetailScreen(onBack: () -> Unit = {}) {
    val viewModel: DetailViewModel = hiltViewModel()
    LaunchedEffect(Unit) {
        viewModel.load()
    }

    val toastContext = LocalContext.current
    LaunchedEffect(viewModel.infoMessage) {
        viewModel.infoMessage?.let {
            Toast.makeText(toastContext, it, Toast.LENGTH_SHORT).show()
            viewModel.consumeInfoMessage()
        }
    }

    val scrollState = rememberScrollState()
    // Pinned: la barra resta ancorata. Serve geometria stabile per il titolo
    // "collassante" che migra dalla copertina alla navbar durante lo scroll.
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior()
    // hazeSource locale: il contenuto (copertina + sezioni) sta dentro, la capsula
    // vetro del back è disegnata dopo come fratello → il blur la riempie davvero.
    val detailHaze = remember { HazeState() }
    val density = LocalDensity.current
    // Soglie in dp per il fade-in del titolo navbar:
    // - Il titolo in-content vive a metà del backdrop 430dp (offset ~215dp dall'inizio
    //   del contenuto scrollabile, cioè sotto status bar + top app bar collapsed).
    // - Iniziamo il fade poco prima che esca dal viewport e lo completiamo 80dp dopo.
    val titleFadeStartDp = 160.dp
    val titleFadeEndDp = 240.dp
    val titleAlpha by remember(density) {
        derivedStateOf {
            val scrolled = scrollState.value
            val maxScroll = scrollState.maxValue
            val startPx = with(density) { titleFadeStartDp.toPx() }
            val endPx = with(density) { titleFadeEndDp.toPx() }
            val fade = ((scrolled - startPx) / (endPx - startPx)).coerceIn(0f, 1f)
            // Se la pagina non scrolla abbastanza da portar via il titolo in-content,
            // tieni il titolo navbar nascosto.
            if (maxScroll < startPx) 0f else fade
        }
    }

    // Colore della top bar: trasparente in cima (sopra la copertina), sfuma fino al
    // nero (background) man mano che si scrolla — stesso standard delle altre sezioni.
    val navBarColor = MaterialTheme.colorScheme.background
    val barColor by remember(navBarColor) {
        derivedStateOf { navBarColor.copy(alpha = titleAlpha) }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Box(modifier = Modifier.fillMaxSize().hazeSource(detailHaze)) {
            if (viewModel.isLoading) {
                DetailSkeleton(modifier = Modifier.fillMaxSize())
            } else if (viewModel.loadError != null) {
                ErrorState(
                    message = viewModel.loadError!!,
                    onRetry = { viewModel.load() },
                    modifier = Modifier.fillMaxSize()
                )
            } else {
                viewModel.item?.let { item ->
                    DetailContent(
                        item = item,
                        viewModel = viewModel,
                        scrollState = scrollState,
                        scrollBehavior = scrollBehavior,
                        modifier = Modifier.fillMaxSize()
                    )
                }
            }
        }

        // Solo il tasto indietro a capsula vetro (stile navbar). Il titolo resta
        // gestito dall'overlay collassante sotto.
        GlassTopBar(
            modifier = Modifier.align(Alignment.TopStart),
            onLeading = onBack,
            hazeState = detailHaze
        )

        // Titolo collassante: un unico Text che parte grande sopra la copertina e
        // migra (sale + rimpicciolisce) fino allo slot della navbar. Disegnato per
        // ultimo → sta sopra la barra. Geometria letta in draw phase (no ricomposizioni).
        viewModel.item?.takeIf { !viewModel.isLoading && viewModel.loadError == null }?.let { item ->
            val statusBarPx = with(density) {
                WindowInsets.statusBars.asPaddingValues().calculateTopPadding().toPx()
            }
            val topBarPx = with(density) { TopAppBarDefaults.TopAppBarExpandedHeight.toPx() }
            val coverTopPx = with(density) { statusBarPx + topBarPx + (16 + 120).dp.toPx() }
            val coverXPx = with(density) { 16.dp.toPx() }
            // Allineato col titolo a fianco della capsula vetro: dopo cerchio (48dp)
            // + spacer (12dp) + padding riga (12dp).
            val barXPx = with(density) { 72.dp.toPx() }
            val collapsedScale = 0.68f
            // Centro verticale della freccia = padding top barra (8dp) + mezzo cerchio (24dp).
            val barCenterPx = statusBarPx + with(density) { 32.dp.toPx() }
            // Oltre l'aggancio, continuando a scrollare il titolo sfuma via così non
            // resta incollato sopra il contenuto.
            val fadeAfterDockPx = with(density) { 130.dp.toPx() }
            // Altezza reale del testo dopo il layout (non stimata): così la centratura
            // è esatta su qualunque device/font/scala, niente nudge magico.
            var textHeightPx by remember { mutableStateOf(0f) }

            Text(
                text = item.displayTitle,
                // Niente font padding + line height "trimmata": il box del testo aderisce
                // ai glifi, così la centratura verticale combacia con la freccia.
                style = MaterialTheme.typography.headlineLarge.copy(
                    platformStyle = PlatformTextStyle(includeFontPadding = false),
                    lineHeightStyle = LineHeightStyle(
                        alignment = LineHeightStyle.Alignment.Center,
                        trim = LineHeightStyle.Trim.Both
                    )
                ),
                color = MaterialTheme.colorScheme.onBackground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                onTextLayout = { textHeightPx = it.size.height.toFloat() },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(end = 16.dp)
                    .graphicsLayer {
                        val scroll = scrollState.value.toFloat()
                        val maxScroll = scrollState.maxValue.toFloat()
                        // Top da agganciare alla navbar: centro barra meno mezza altezza
                        // (già scalata) del testo → centro glifi = centro freccia.
                        val barTopPx = barCenterPx - textHeightPx * collapsedScale / 2f
                        // Distanza di scroll necessaria per agganciare; su pagine corte
                        // si limita allo scroll disponibile così il titolo dock comunque
                        // a fine corsa invece di restare sospeso a metà.
                        val dockScroll = if (maxScroll <= 0f) 0f
                            else minOf(coverTopPx - barTopPx, maxScroll)
                        // p: 0 = espanso sulla copertina, 1 = agganciato alla navbar.
                        val p = if (dockScroll <= 0f) 0f
                            else (scroll / dockScroll).coerceIn(0f, 1f)
                        transformOrigin = TransformOrigin(0f, 0f)
                        translationY = lerp(coverTopPx, barTopPx, p)
                        translationX = lerp(coverXPx, barXPx, p)
                        val s = lerp(1f, collapsedScale, p)
                        scaleX = s
                        scaleY = s
                        // Dopo l'aggancio (p==1) sfuma proseguendo lo scroll.
                        val extra = (scroll - dockScroll).coerceAtLeast(0f)
                        alpha = (1f - extra / fadeAfterDockPx).coerceIn(0f, 1f)
                    }
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DetailContent(
    item: TmdbItem,
    viewModel: DetailViewModel,
    scrollState: androidx.compose.foundation.ScrollState,
    scrollBehavior: androidx.compose.material3.TopAppBarScrollBehavior,
    modifier: Modifier = Modifier
) {
    val windowSizeClass = LocalWindowSizeClass.current
    val configuration = LocalConfiguration.current
    val isLandscapeTablet = windowSizeClass.isLandscapeTablet(configuration.orientation)
    val horizontalPadding = windowSizeClass.contentPadding

    Box(modifier = modifier.fillMaxSize().background(Color.Black)) {
        // Hero più alto su tablet landscape per un look cinematografico stile TV;
        // su telefono / tablet portrait resta 430dp.
        val heroHeight = if (isLandscapeTablet) 500.dp else 430.dp
        // px dell'area copertina, usato per legare scroll → parallax/darkening.
        val backdropPx = with(LocalDensity.current) { heroHeight.toPx() }
        // Backdrop (mostriamo sempre l'area hero; placeholder se manca).
        val backdropUrl = item.backdropPath?.takeIf { it.isNotBlank() }
            ?: item.posterPath?.takeIf { it.isNotBlank() }

        // Layout unico full-bleed (stile TV): copertina a tutta larghezza in alto,
        // contenuto sovrapposto sul terzo inferiore. Su tablet landscape il testo e i
        // bottoni restano vincolati alla metà sinistra così non si stirano sullo
        // schermo largo, mentre le sezioni a scorrimento (episodi/consigliati) usano
        // tutta la larghezza come sulla TV.
        run {
            // Backdrop full-width at top
            if (backdropUrl != null) {
                // clipToBounds: il graphicsLayer sotto scala l'immagine (fino a 1.06×)
                // attorno al centro; senza clip l'immagine ingrandita sconfinerebbe
                // oltre l'altezza del layout e andrebbe a coprire la top bar.
                AsyncImage(
                    model = TMDBImage.url(backdropUrl, TMDBImage.Size.W1280),
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(heroHeight)
                        .clipToBounds()
                        .graphicsLayer {
                            val scroll = scrollState.value.toFloat()
                            val frac = (scroll / backdropPx).coerceIn(0f, 1f)
                            translationY = -scroll * 0.2f
                            val s = 1f + frac * 0.06f
                            scaleX = s
                            scaleY = s
                        }
                )
            } else {
                ImagePlaceholder(
                    label = "Copertina non disponibile",
                    iconSizeDp = 64.dp,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(heroHeight)
                )
            }

            // Static darkening overlay
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(heroHeight)
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

            // Scroll-driven darkening
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(heroHeight)
                    .graphicsLayer {
                        alpha = (scrollState.value.toFloat() / backdropPx).coerceIn(0f, 1f)
                    }
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(
                                Color.Black.copy(alpha = 0.45f),
                                Color.Black.copy(alpha = 0.8f),
                                Color.Black
                            )
                        )
                    )
            )

            // Bottom fade-out
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(heroHeight + 50.dp)
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(
                                Color.Transparent,
                                Color.Transparent,
                                Color.Black.copy(alpha = 0.2f),
                                Color.Black.copy(alpha = 0.6f),
                                Color.Black.copy(alpha = 0.95f),
                                Color.Black
                            ),
                            startY = 0f,
                            endY = Float.POSITIVE_INFINITY
                        )
                    )
            )

            // Scrollable content + dialogs (all inside outer Box so dialogs overlay properly)
            Box(
                modifier = Modifier
                    .fillMaxSize()
            ) {
                val statusBarPadding = androidx.compose.foundation.layout.WindowInsets.statusBars
                    .asPaddingValues()
                    .calculateTopPadding()
                val topBarHeight = TopAppBarDefaults.TopAppBarExpandedHeight
                val topBarOffsetDp = with(LocalDensity.current) { scrollBehavior.state.heightOffset.toDp() }
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .nestedScroll(scrollBehavior.nestedScrollConnection)
                        .verticalScroll(scrollState)
                        .padding(top = statusBarPadding + topBarHeight + topBarOffsetDp),
                    verticalArrangement = Arrangement.spacedBy(0.dp)
                ) {
                    DetailScrollContent(
                        item = item,
                        viewModel = viewModel,
                        scrollState = scrollState,
                        horizontalPadding = horizontalPadding,
                        isLandscapeTablet = isLandscapeTablet,
                        backdropPx = backdropPx
                    )
                }
            }

            // Dialogs (inside outer Box, outside if/else so they show on both layouts)
            Box(modifier = Modifier.fillMaxSize()) {
                // Provider Picker
                if (viewModel.showProviderPicker) {
                    GlassAlertDialog(
                        onDismissRequest = { viewModel.showProviderPicker = false },
                        hazeState = LocalHazeState.current,
                        title = "Scegli la versione",
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
                            GlassDialogPrimaryButton(onClick = { viewModel.refreshProvider() }) {
                                Text("Aggiorna")
                            }
                        },
                        dismissButton = {
                            GlassDialogNeutralButton(onClick = { viewModel.showProviderPicker = false }) {
                                Text("Chiudi")
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
                                Spacer(modifier = Modifier.width(12.dp))
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
            }
        }
    }
}

/** Shared scrollable content for both phone (stacked) and tablet landscape (side-by-side) layouts. */
@Composable
private fun DetailScrollContent(
    item: TmdbItem,
    viewModel: DetailViewModel,
    scrollState: androidx.compose.foundation.ScrollState,
    horizontalPadding: androidx.compose.ui.unit.Dp,
    isLandscapeTablet: Boolean,
    backdropPx: Float
) {
    // Spazio sopra i metadati così cadono sul terzo inferiore della copertina.
    // Su tablet landscape l'hero è più alto (500dp) → serve più spinta verso il basso.
    val topSpacer = if (isLandscapeTablet) 170.dp else 120.dp
    Column(
        modifier = Modifier
            // Stile TV: su tablet landscape testo + bottoni occupano la metà sinistra,
            // niente stiramento sullo schermo largo.
            .then(if (isLandscapeTablet) Modifier.fillMaxWidth(0.62f) else Modifier.fillMaxWidth())
            .padding(horizontal = horizontalPadding, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Spacer per spingere i metadati a metà del backdrop 430dp (look poster-style).
        Spacer(modifier = Modifier.height(topSpacer))

                // Slot riservato al titolo: il testo vero è l'overlay collassante,
                // disegnato sopra la barra. Qui teniamo solo lo spazio così i metadati
                // restano allineati a dove appare il titolo (stato espanso).
                Spacer(modifier = Modifier.height(40.dp))

                    // Meta
                    Text(
                        text = viewModel.metaLine.ifBlank { "Dati non disponibili" },
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (viewModel.metaLine.isNotEmpty())
                            MaterialTheme.colorScheme.onSurfaceVariant
                        else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                    )
                    Text(
                        text = viewModel.genresLine.ifBlank { "Generi non disponibili" },
                        style = MaterialTheme.typography.bodySmall,
                        color = if (viewModel.genresLine.isNotEmpty())
                            MaterialTheme.colorScheme.onSurfaceVariant
                        else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                    )
                    if (viewModel.releaseStatusText.isNotEmpty()) {
                        Text(
                            text = viewModel.releaseStatusText,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onBackground
                        )
                    }

                    // Overview
                    Text(
                        text = item.overview?.takeIf { it.isNotBlank() }
                            ?: "Descrizione non disponibile",
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (!item.overview.isNullOrBlank())
                            MaterialTheme.colorScheme.onBackground
                        else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                    )

                    val navController = LocalNavController.current
                    val isInWatchlist by viewModel.isInWatchlist.collectAsState()
                    val isReady = viewModel.providerAvailability == ProviderAvailability.READY
                    val needsPicker = viewModel.providerAvailability == ProviderAvailability.NEEDS_PICKER
                    val isResolving = viewModel.providerAvailability == ProviderAvailability.RESOLVING
                    val isUnavailable = viewModel.providerAvailability == ProviderAvailability.UNAVAILABLE
                    val isNoProvider = viewModel.providerAvailability == ProviderAvailability.NO_PROVIDER

                    // Movie progress bar + timestamp (iOS parity)
                    val movieProgress = viewModel.movieResumeEntry
                    if (!viewModel.isTV && movieProgress != null && movieProgress.durationSeconds > 0) {
                        val pct = Format.percent(movieProgress.positionSeconds, movieProgress.durationSeconds)
                        if (pct > 0) {
                            LinearProgressIndicator(
                                progress = { (pct / 100f).toFloat() },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(4.dp)
                                    .clip(RoundedCornerShape(2.dp)),
                                color = MaterialTheme.colorScheme.primary,
                                trackColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.28f),
                                strokeCap = androidx.compose.ui.graphics.StrokeCap.Butt,
                                drawStopIndicator = {},
                            )
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "${Format.time(movieProgress.positionSeconds)} / ${Format.time(movieProgress.durationSeconds)}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = Color.White.copy(alpha = 0.7f)
                                )
                                TextButton(
                                    onClick = { viewModel.resetMovieProgress() },
                                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
                                ) {
                                    Text(
                                        "Riparti dall'inizio",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = Color.White.copy(alpha = 0.7f)
                                    )
                                }
                            }
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        BrandButton(
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
                                Icon(Icons.Filled.PlayArrow, contentDescription = null)
                                Spacer(modifier = Modifier.width(8.dp))
                            }
                            Text(viewModel.playLabel)
                        }
                        BrandIconButton(
                            onClick = { viewModel.toggleWatchlist() },
                            icon = if (isInWatchlist) Icons.Filled.Bookmark else Icons.Filled.BookmarkBorder,
                            contentDescription = if (isInWatchlist) "Rimuovi da lista" else "Aggiungi a lista",
                            active = isInWatchlist
                        )
                        if (!isUnavailable && !isNoProvider) {
                            BrandIconButton(
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
                                },
                                icon = Icons.Filled.Download,
                                contentDescription = "Scarica"
                            )
                        }
                    }

                    if (viewModel.isTV && isReady && viewModel.nextAfterResumeEpisode != null) {
                        BrandSecondaryButton(
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
                            Icon(Icons.Filled.SkipNext, contentDescription = null)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Vai al prossimo")
                        }
                    }

                    // Azioni secondarie compatte: marca visto + trailer sulla
                    // stessa riga, stile glass coerente con gli altri bottoni.
                    val context = LocalContext.current
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        BrandSecondaryButton(
                            onClick = {
                                if (viewModel.isWatched) viewModel.markUnwatched()
                                else viewModel.markWatched()
                            },
                            active = viewModel.isWatched,
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(
                                if (viewModel.isWatched) Icons.Filled.CheckCircle
                                else Icons.Outlined.CheckCircle,
                                contentDescription = null
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(if (viewModel.isWatched) "Visto" else "Segna visto", maxLines = 1)
                        }
                        viewModel.trailerUrl?.let { url ->
                            BrandSecondaryButton(
                                onClick = {
                                    val intent = CustomTabsIntent.Builder().build()
                                    intent.launchUrl(context, Uri.parse(url))
                                },
                                modifier = Modifier.weight(1f)
                            ) {
                                Icon(Icons.Filled.SmartDisplay, contentDescription = null)
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("Trailer", maxLines = 1)
                            }
                        }
                    }

                    // Cast
                    Text(
                        text = "Cast: ${viewModel.castLine.ifBlank { "Cast non disponibile" }}",
                        style = MaterialTheme.typography.bodySmall,
                        color = if (viewModel.castLine.isNotEmpty())
                            MaterialTheme.colorScheme.onSurfaceVariant
                        else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                    )

                    // TV summary
                    if (viewModel.tvSummary.isNotEmpty()) {
                        Text(
                            text = viewModel.tvSummary,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
            }

            // Bottom sections — nero ereditato dal Box genitore, così il gradient
            // overlay copre la giunzione tra copertina e contenuto.
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // Episodes (TV) — nascosto se il titolo è mancante (nessun senso mostrarli).
                val hasRealTitle = !item.title.isNullOrBlank() || !item.name.isNullOrBlank()
                if (viewModel.isTV && viewModel.seasons.isNotEmpty() && hasRealTitle) {
                    Spacer(modifier = Modifier.height(8.dp))
                    if (viewModel.providerAvailability == ProviderAvailability.UNAVAILABLE ||
                        viewModel.providerAvailability == ProviderAvailability.NO_PROVIDER) {
                        // Streaming non disponibile / nessun provider: niente lista episodi, solo placeholder.
                        EpisodesUnavailable(message = viewModel.providerMessage)
                    } else {
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

        Spacer(modifier = Modifier.height(LocalBottomBarPadding.current))
    }

@Composable
private fun EpisodesUnavailable(message: String?) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionHeader(
            title = "Episodi",
            icon = Icons.Filled.PlayArrow
        )
        Text(
            text = message ?: "Streaming non disponibile per questa serie.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
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
            icon = Icons.Filled.PlayArrow
        )

        // Season picker
        val seasonsScrollState = rememberScrollState()
        val canScrollLeft = seasonsScrollState.value > 0
        val canScrollRight = seasonsScrollState.value < seasonsScrollState.maxValue
        val showScrollHints = viewModel.seasons.size > 8
        val fadeBg = MaterialTheme.colorScheme.background.copy(alpha = 0.95f)
        val hintWidth = 56.dp
        Box(modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .then(
                        if (showScrollHints) {
                            Modifier.horizontalScroll(seasonsScrollState)
                        } else Modifier
                    ),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
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

        if (viewModel.loadingEpisodes) {
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                contentPadding = PaddingValues(horizontal = 4.dp)
            ) {
                items(4) {
                    // Skeleton allineato a EpisodeCard: still 16:9 + area metadati stessa altezza.
                    Column(modifier = Modifier.width(220.dp)) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .aspectRatio(16f / 9f)
                                .clip(RoundedCornerShape(10.dp))
                                .background(Color(0xFF1E1E1E))
                        )
                        Column(modifier = Modifier.height(EPISODE_META_HEIGHT)) {
                            Box(
                                modifier = Modifier
                                    .padding(top = 6.dp)
                                    .fillMaxWidth(0.7f)
                                    .height(14.dp)
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(Color(0xFF1E1E1E))
                            )
                            Box(
                                modifier = Modifier
                                    .padding(top = 6.dp)
                                    .fillMaxWidth()
                                    .height(11.dp)
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(Color(0xFF1E1E1E))
                            )
                            Box(
                                modifier = Modifier
                                    .padding(top = 4.dp)
                                    .fillMaxWidth(0.85f)
                                    .height(11.dp)
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(Color(0xFF1E1E1E))
                            )
                        }
                    }
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

@OptIn(ExperimentalMaterial3Api::class)
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
            val stillUrl = episode.stillPath?.takeIf { it.isNotBlank() }
            if (stillUrl != null) {
                AsyncImage(
                    model = TMDBImage.url(stillUrl, TMDBImage.Size.W300),
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxWidth()
                )
            } else {
                ImagePlaceholder(
                    label = "Immagine non disponibile",
                    iconSizeDp = 32.dp,
                    modifier = Modifier.fillMaxSize()
                )
            }
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
                    strokeCap = androidx.compose.ui.graphics.StrokeCap.Butt,
                    drawStopIndicator = {},
                )
            }
            // White play/replay arrow centered over the still.
            Icon(
                imageVector = if (watched) Icons.Filled.Replay else Icons.Filled.PlayArrow,
                contentDescription = if (watched) "Riguarda" else "Riproduci",
                tint = Color.White,
                modifier = Modifier
                    .align(Alignment.Center)
                    .size(44.dp)
            )
        }
        // Area metadati ad altezza fissa: titolo (1 riga) + overview (2 righe).
        // Stessa altezza usata dallo skeleton così non c'è slittamento del layout.
        Column(modifier = Modifier.height(EPISODE_META_HEIGHT)) {
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
            Text(
                text = episode.overview?.takeIf { it.isNotBlank() } ?: "",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                minLines = 2,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

/** Altezza fissa dell'area titolo+overview di EpisodeCard (condivisa con lo skeleton). */
private val EPISODE_META_HEIGHT = 58.dp

@Composable
private fun ReviewsSection(reviews: List<TmdbReview>) {
    var selectedReview by remember { mutableStateOf<TmdbReview?>(null) }

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
                ReviewCard(
                    review = review,
                    onShowFull = { selectedReview = review }
                )
            }
        }
    }

    selectedReview?.let { review ->
        ReviewDetailDialog(
            review = review,
            onDismiss = { selectedReview = null }
        )
    }
}

@Composable
private fun ReviewDetailDialog(
    review: TmdbReview,
    onDismiss: () -> Unit
) {
    val scrollState = rememberScrollState()

    GlassDialog(
        onDismissRequest = onDismiss,
        hazeState = LocalHazeState.current,
        modifier = Modifier
            .widthIn(min = 280.dp, max = 560.dp)
            .padding(horizontal = 24.dp)
            .heightIn(max = 420.dp)
    ) {
        Column(
            modifier = Modifier.padding(24.dp, 20.dp)
        ) {
            Text(
                text = review.authorDetails?.name?.takeIf { it.isNotBlank() }
                    ?: review.authorDetails?.username?.takeIf { it.isNotBlank() }
                    ?: review.author.takeIf { it.isNotBlank() }
                    ?: "Anonimo",
                color = Color.White,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(bottom = 12.dp)
            )
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f, fill = false)
                    .verticalScroll(scrollState)
            ) {
                Text(
                    text = review.content.trim(),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 20.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                verticalAlignment = Alignment.CenterVertically
            ) {
                GlassDialogNeutralButton(onClick = onDismiss) {
                    Text("Chiudi")
                }
            }
        }
    }
}

@Composable
private fun ReviewCard(review: TmdbReview, onShowFull: () -> Unit) {
    var isOverflowing by remember { mutableStateOf(false) }
    val fullText = review.content.trim()

    Column(
        modifier = Modifier
            .width(300.dp)
            .height(170.dp)
            .background(
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                shape = RoundedCornerShape(12.dp)
            )
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = review.authorDetails?.name?.takeIf { it.isNotBlank() }
                    ?: review.authorDetails?.username?.takeIf { it.isNotBlank() }
                    ?: review.author.takeIf { it.isNotBlank() }
                    ?: "Anonimo",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onBackground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )
            review.authorDetails?.rating?.let {
                Text(
                    text = "★ ${String.format("%.1f", it)}",
                    style = MaterialTheme.typography.labelMedium,
                    color = Color(0xFFFFC107)
                )
            }
        }
        Text(
            text = fullText,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 6,
            overflow = TextOverflow.Ellipsis,
            onTextLayout = { isOverflowing = it.hasVisualOverflow }
        )
        if (isOverflowing) {
            TextButton(
                onClick = onShowFull,
                modifier = Modifier.padding(0.dp),
                contentPadding = PaddingValues(0.dp)
            ) {
                Text(
                    text = "Leggi tutto",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary
                )
            }
        }
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
        BrandButton(onClick = onRetry) {
            Text("Riprova")
        }
    }
}

@Composable
private fun DetailSkeleton(modifier: Modifier = Modifier) {
    val statusBarPadding = androidx.compose.foundation.layout.WindowInsets.statusBars
        .asPaddingValues()
        .calculateTopPadding()
    val topBarHeight = 64.dp
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Color.Black)
    ) {
        // Spacer per status bar + top app bar (skeleton non ha navbar interattiva).
        Spacer(
            modifier = Modifier
                .fillMaxWidth()
                .height(statusBarPadding + topBarHeight)
        )
        // Backdrop placeholder, stessa altezza della backdrop reale.
        SkeletonBox(
            width = null,
            height = 430.dp,
            modifier = Modifier.fillMaxWidth()
        )
        // Blocco contenuto: titolo + meta + overview + actions, allineato a quello reale.
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Titolo (headlineLarge ≈ ~32sp).
            SkeletonBox(width = 240.dp, height = 32.dp)
            // Meta line (data/durata/voto).
            SkeletonBox(width = 180.dp, height = 14.dp)
            // Generi.
            SkeletonBox(width = 220.dp, height = 12.dp)
            // Stato uscita.
            SkeletonBox(width = 160.dp, height = 14.dp)
            Spacer(modifier = Modifier.height(4.dp))
            // Overview: 3 righe di larghezza decrescente.
            SkeletonBox(width = null, height = 14.dp)
            SkeletonBox(width = null, height = 14.dp)
            SkeletonBox(width = 200.dp, height = 14.dp)
            Spacer(modifier = Modifier.height(8.dp))
            // Riga azioni: bottone play + due icone.
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                SkeletonBox(
                    width = null,
                    height = 44.dp,
                    modifier = Modifier.weight(1f)
                )
                SkeletonBox(width = 44.dp, height = 44.dp)
                SkeletonBox(width = 44.dp, height = 44.dp)
            }
        }
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
