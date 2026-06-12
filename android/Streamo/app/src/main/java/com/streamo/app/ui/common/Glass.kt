package com.streamo.app.ui.common

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.dp

/**
 * Token del linguaggio "glass": tinta bianca semitrasparente + bordo sottile
 * su sfondo scuro. Stessa ricetta dei bottoni hero ([BrandSecondaryButton]);
 * solo tinta, nessun blur.
 */
object GlassDefaults {
    /** Riempimento glass scuro. */
    val Container = Color.White.copy(alpha = 0.08f)

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
    content: @Composable ColumnScope.() -> Unit
) {
    Card(
        modifier = modifier,
        shape = shape,
        colors = CardDefaults.cardColors(
            containerColor = GlassDefaults.Container,
            contentColor = Color.White
        ),
        border = BorderStroke(1.dp, GlassDefaults.Border),
        content = content
    )
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
