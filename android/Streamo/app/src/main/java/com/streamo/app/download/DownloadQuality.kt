package com.streamo.app.download

/** Tipo di rete corrente, usato per scegliere la preferenza qualità download. */
enum class NetworkType { WIFI, MOBILE }

/**
 * Richiesta di scelta qualità da mostrare nella modale (preferenza "Chiedi").
 * [heights] = risoluzioni rilevate (decrescenti, anche non standard); vuota = non rilevate.
 * [appliesToAll] = la scelta vale per tutti gli episodi (download di stagione).
 */
data class DownloadQualityRequest(
    val networkType: NetworkType,
    val heights: List<Int>,
    val appliesToAll: Boolean
)

/**
 * Preferenza di qualità download (per rete) e scelta concreta nella modale.
 * - [Ask]   → chiedere all'utente (mostra la modale con le risoluzioni rilevate).
 * - [Max]   → sempre la risoluzione più alta disponibile.
 * - [Cap]   → tetto massimo: scarica la variante ≤ [height] più alta disponibile.
 *
 * Serializzata in DataStore come: "ask" | "max" | "<height>".
 */
sealed class DownloadQualityPref {
    object Ask : DownloadQualityPref()
    object Max : DownloadQualityPref()
    data class Cap(val height: Int) : DownloadQualityPref()

    /** Token persistito in DataStore. */
    fun serialize(): String = when (this) {
        is Ask -> "ask"
        is Max -> "max"
        is Cap -> height.toString()
    }

    /** Etichetta UI. */
    fun label(): String = when (this) {
        is Ask -> "Chiedi"
        is Max -> "Massima"
        is Cap -> "${height}p"
    }

    /** Etichetta salvata su DownloadEntry.quality (mai per [Ask]). */
    fun entryQualityLabel(): String = when (this) {
        is Ask -> "Massima" // fallback difensivo: Ask non dovrebbe arrivare qui
        is Max -> "Massima"
        is Cap -> "${height}p"
    }

    companion object {
        /**
         * Opzioni offerte nelle Impostazioni. `by lazy` per evitare il bug di ordine di
         * inizializzazione: una `val` eager nel companion può referenziare gli `object`
         * fratelli (Ask/Max) prima che siano inizializzati → elementi null nella lista.
         */
        val SETTINGS_OPTIONS: List<DownloadQualityPref> by lazy {
            listOf(Ask, Max, Cap(1080), Cap(720), Cap(480))
        }

        fun parse(raw: String?): DownloadQualityPref = when (val v = raw?.trim()) {
            null, "", "ask" -> Ask
            "max" -> Max
            else -> v.toIntOrNull()?.let { Cap(it) } ?: Ask
        }

        /**
         * Tetto in altezza (px) ricavato da DownloadEntry.quality.
         * null = nessun limite (scarica la più alta). "Massima"/non numerico → null.
         */
        fun capHeightFromEntryQuality(quality: String?): Int? {
            if (quality.isNullOrBlank()) return null
            return Regex("\\d+").find(quality)?.value?.toIntOrNull()
        }
    }
}
