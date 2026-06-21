package com.streamo.app.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import android.os.Build
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.HazeTint
import dev.chrisbanes.haze.hazeEffect
import dev.chrisbanes.haze.hazeSource

/**
 * Unico [HazeState] dell'app, esposto da `RootTabView` (che è anche l'unica
 * `hazeSource`). Le barre flottanti — navbar in basso e [GlassTopBar] in alto —
 * lo condividono così sfocano lo stesso contenuto sottostante. `null` fuori da
 * RootTabView (es. preview): in quel caso le barre restano vetro scuro senza blur.
 */
val LocalHazeState = staticCompositionLocalOf<HazeState?> { null }

/**
 * Modalità prestazioni: quando true la UI glass salta il blur (Haze) e le
 * animazioni, usando una tinta piatta semitrasparente. Pilotata dalla
 * preferenza utente, fornita alla radice (vedi MainActivity). Default false.
 */
val LocalReducedEffects = staticCompositionLocalOf { false }

/**
 * Il blur reale (Haze → RenderEffect) è affidabile solo da Android 12L (API 32);
 * sotto fa un fallback software lento/brutto. Su questi device la modalità
 * prestazioni è forzata sempre attiva e il relativo toggle in Impostazioni è
 * nascosto (non avrebbe effetto utile).
 */
val isBlurSupported: Boolean
    get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S_V2

/**
 * Applica l'effetto vetro alla capsula: blur reale del contenuto sotto (Haze,
 * con fallback automatico a scrim sotto API 32) + bordo sottile. Stessa ricetta
 * della navbar (RootTabView.GlassBottomBar) e della top bar: `clip` PRIMA di
 * `hazeEffect`, niente `background` opaco sotto (romperebbe il blur), tinta
 * scura sopra via `tints`. Se `hazeState` è null (preview o fuori da RootTabView)
 * — o se [LocalReducedEffects] è attivo — fa fallback a [GlassDefaults.NavbarFill]:
 * solo tinta scura semitrasparente, niente blur. La tinta del fallback combacia
 * con quella del blur (scura) così l'aspetto resta coerente.
 */
fun Modifier.glassCapsule(hazeState: HazeState?, shape: androidx.compose.ui.graphics.Shape): Modifier = composed {
    val reduced = LocalReducedEffects.current
    val clipped = clip(shape)
    val blurred = when {
        reduced -> clipped.background(GlassDefaults.SolidFill)
        hazeState != null -> clipped.hazeEffect(state = hazeState) {
            backgroundColor = Color.Black
            tints = listOf(HazeTint(Color.Black.copy(alpha = 0.35f)))
            blurRadius = 24.dp
            noiseFactor = 0f
        }
        else -> clipped.background(GlassDefaults.NavbarFill)
    }
    blurred.border(1.dp, GlassDefaults.Border, shape)
}

/**
 * Top bar in stile "glass" coerente con la navbar: capsula tonda flottante per il
 * tasto leading (back/chiudi), titolo come testo nudo senza sfondo, e un singolo
 * gruppo-capsula a destra per le azioni. Galleggia sopra il contenuto (che scorre
 * sotto e viene sfocato). Usa [LocalHazeState] per il blur.
 *
 * Pensata per essere posata come overlay in cima allo schermo; tipicamente via
 * [GlassTopBarScaffold], che misura l'altezza e la propaga al contenuto.
 */
@Composable
fun GlassTopBar(
    modifier: Modifier = Modifier,
    onLeading: (() -> Unit)? = null,
    leadingIcon: ImageVector = Icons.AutoMirrored.Filled.ArrowBack,
    leadingDesc: String = "Indietro",
    hazeState: HazeState? = LocalHazeState.current,
    actions: (@Composable RowScope.() -> Unit)? = null
) {
    // Solo i controlli flottanti: freccia (capsula vetro a sé) a sinistra, gruppo
    // azioni (pillola vetro) a destra. Solo i bottoni hanno sfondo. Il titolo NON
    // sta qui: vive nel contenuto scrollabile (vedi [GlassLargeTitle]).
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(WindowInsets.statusBars.asPaddingValues())
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (onLeading != null) {
            Box(modifier = Modifier.glassCapsule(hazeState, CircleShape)) {
                IconButton(onClick = onLeading) {
                    Icon(
                        imageVector = leadingIcon,
                        contentDescription = leadingDesc,
                        tint = Color.White
                    )
                }
            }
        }
        Spacer(modifier = Modifier.weight(1f))
        if (actions != null) {
            Row(
                modifier = Modifier
                    .glassCapsule(hazeState, GlassDefaults.ChipShape)
                    .padding(horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(0.dp),
                content = actions
            )
        }
    }
}

/**
 * Titolo grande della schermata, da posare come PRIMO elemento del contenuto
 * scrollabile (Column/LazyColumn/Grid) così scorre via insieme al contenuto,
 * sotto la freccia flottante. Testo nudo, nessuno sfondo.
 */
@Composable
fun GlassLargeTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        color = Color.White,
        fontWeight = FontWeight.Bold,
        fontSize = 28.sp,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
        modifier = modifier.padding(vertical = 4.dp)
    )
}

/**
 * Scaffold leggero per le schermate con [GlassTopBar] flottante: il contenuto è a
 * tutta altezza e scorre sotto la barra (che lo sfoca). Misura l'altezza reale
 * della barra e la passa al `content` come `topPadding` perché il primo elemento
 * non resti coperto. Il margine in basso resta gestito da `LocalBottomBarPadding`.
 */
@Composable
fun GlassTopBarScaffold(
    modifier: Modifier = Modifier,
    onLeading: (() -> Unit)? = null,
    leadingIcon: ImageVector = Icons.AutoMirrored.Filled.ArrowBack,
    leadingDesc: String = "Indietro",
    actions: (@Composable RowScope.() -> Unit)? = null,
    trailingOverlay: @Composable BoxScope.(topPadding: Dp) -> Unit = {},
    content: @Composable (topPadding: Dp) -> Unit
) {
    var barHeightPx by remember { mutableStateOf(0) }
    val topPadding = with(LocalDensity.current) { barHeightPx.toDp() }

    // hazeSource LOCALE che avvolge solo il contenuto: la barra è disegnata DOPO,
    // come fratello, così il blur cattura davvero il contenuto sotto (stessa
    // topologia della navbar). Se fosse dentro la sorgente non catturerebbe nulla.
    val hazeState = remember { HazeState() }

    Box(modifier = modifier.fillMaxSize()) {
        Box(modifier = Modifier.fillMaxSize().hazeSource(hazeState)) {
            content(topPadding)
        }
        // Controlli flottanti fissi (freccia + azioni). Il titolo grande sta nel
        // contenuto scrollabile, posato dallo screen come primo elemento.
        GlassTopBar(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .onSizeChanged { barHeightPx = it.height },
            onLeading = onLeading,
            leadingIcon = leadingIcon,
            leadingDesc = leadingDesc,
            hazeState = hazeState,
            actions = actions
        )
        trailingOverlay(topPadding)
    }
}
