package com.streamo.app.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

/**
 * Scala di raggi condivisa (audit stile 2026-07, vedi
 * plans/ANIMATION_STYLE_AUDIT_PLAN.md §2.1): raccoglie i valori di
 * `RoundedCornerShape` già in uso nell'app invece di lasciarli come literal
 * ad-hoc ripetuti in ogni schermata. Non è collegata a `MaterialTheme(shapes=...)`
 * — i componenti Material3 senza `shape` esplicito continuano a usare i default
 * di sistema, invariati.
 */
object AppShapes {
    /** Barre di progresso e decorazioni sottili (2dp). */
    val hairline = RoundedCornerShape(2.dp)

    /** Badge/thumbnail piccoli (poster overlay, rating badge, …). */
    val xs = RoundedCornerShape(6.dp)

    /** Chip, icone sezione, righe impostazioni compatte. */
    val sm = RoundedCornerShape(8.dp)

    /** Poster card, righe dialog cast, swatch colore. */
    val md = RoundedCornerShape(10.dp)

    /** Badge medi (episodio, bolla tempo player). */
    val mdLg = RoundedCornerShape(12.dp)

    /** Bottoni/dialoghi glass — stesso valore di [com.streamo.app.ui.common.GlassDefaults.Shape]. */
    val lg = RoundedCornerShape(14.dp)

    /** Capsula seek bar player. */
    val xl = RoundedCornerShape(24.dp)
}
