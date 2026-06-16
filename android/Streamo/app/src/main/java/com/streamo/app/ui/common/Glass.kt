package com.streamo.app.ui.common

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.unit.dp

/**
 * Token del linguaggio "glass": tinta bianca semitrasparente + bordo sottile
 * su sfondo scuro. Stessa ricetta dei bottoni hero ([BrandSecondaryButton]);
 * solo tinta, nessun blur.
 */
object GlassDefaults {
    /** Riempimento glass scuro. */
    val Container = Color.White.copy(alpha = 0.08f)

    /**
     * Vetro scuro "navbar": nero semitrasparente, coerente con la barra glass
     * (che fa blur reale su sfondo nero). Usato dai bottoni che non possono
     * fare blur reale — applicare il blur dentro la stessa `hazeSource` fa
     * crashare il RenderThread (SIGSEGV).
     */
    val NavbarFill = Color.Black.copy(alpha = 0.55f)

    /**
     * Riempimento piatto per la modalità prestazioni (niente blur dietro): più
     * opaco di [NavbarFill] perché senza il vetro sfocato sotto la tinta a 0.55
     * resta troppo trasparente e il contenuto traspare male.
     */
    val SolidFill = Color.Black.copy(alpha = 0.86f)

    /**
     * Riempimento per modali e dialog: deve essere sufficientemente opaco da
     * garantire la leggibilità del testo bianco anche su sfondi colorati, ma
     * rimanere riconoscibile come glass con il bordo sottile sopra.
     */
    val DialogFill = Color.Black.copy(alpha = 0.78f)

    /** Bordo sottile, appena percettibile. */
    val Border = Color.White.copy(alpha = 0.12f)

    /** Angoli arrotondati brand (come i bottoni hero). */
    val Shape = RoundedCornerShape(14.dp)

    /** Forma a capsula per chip e filtri. */
    val ChipShape = RoundedCornerShape(50)
}

/** Card con superficie glass: tinta semitrasparente + bordo sottile. */
@Composable
fun GlassCard(
    modifier: Modifier = Modifier,
    shape: Shape = GlassDefaults.Shape,
    colors: androidx.compose.material3.CardColors = CardDefaults.cardColors(
        containerColor = GlassDefaults.Container,
        contentColor = Color.White
    ),
    content: @Composable ColumnScope.() -> Unit
) {
    Card(
        modifier = modifier,
        shape = shape,
        colors = colors,
        border = BorderStroke(1.dp, GlassDefaults.Border),
        content = content
    )
}

/**
 * Snapshot del video già sfocato + la sua origine nella finestra. Catturato via
 * PixelCopy dalla SurfaceView del player (che è pulita, croppata bene → niente bordo
 * verde) e pre-sfocato. Usato da [glassSnapshot] per disegnare il "vetro sul video"
 * senza dover sfocare la SurfaceView live (che Haze non può catturare).
 */
data class GlassSnapshot(val image: ImageBitmap, val originInWindow: Offset)

/**
 * Vetro che mostra il video sfocato dietro la capsula (alternativa a [glassCapsule]
 * quando il video è su SurfaceView e non è sfocabile da Haze). Disegna la fetta dello
 * [snapshot] che cade sotto questo elemento (allineandola con la sua posizione nella
 * finestra), poi una tinta scura per leggibilità + bordo sottile. Se `snapshot` è
 * null fa fallback a tinta piatta [GlassDefaults.NavbarFill].
 */
fun Modifier.glassSnapshot(snapshot: GlassSnapshot?, shape: Shape): Modifier = composed {
    val reduced = LocalReducedEffects.current
    var capsuleOffset by remember { mutableStateOf(Offset.Zero) }
    this
        .onGloballyPositioned { capsuleOffset = it.positionInWindow() }
        .clip(shape)
        .drawBehind {
            if (reduced) {
                drawRect(GlassDefaults.SolidFill)
            } else if (snapshot != null) {
                // Allinea lo snapshot full-frame: la fetta sotto la capsula è
                // (origine video − posizione capsula).
                drawImage(
                    snapshot.image,
                    topLeft = snapshot.originInWindow - capsuleOffset
                )
                drawRect(Color.Black.copy(alpha = 0.35f))
            } else {
                drawRect(GlassDefaults.NavbarFill)
            }
        }
        .border(1.dp, GlassDefaults.Border, shape)
}

/** FilterChip a capsula in stile glass; primary quando selezionato. */
@Composable
fun GlassFilterChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = { Text(label) },
        shape = GlassDefaults.ChipShape,
        colors = FilterChipDefaults.filterChipColors(
            containerColor = GlassDefaults.Container,
            labelColor = Color.White,
            selectedContainerColor = MaterialTheme.colorScheme.primary,
            selectedLabelColor = MaterialTheme.colorScheme.onPrimary
        ),
        border = FilterChipDefaults.filterChipBorder(
            enabled = true,
            selected = selected,
            borderColor = GlassDefaults.Border,
            selectedBorderColor = Color.Transparent
        ),
        modifier = modifier
    )
}
