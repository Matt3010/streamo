package com.streamo.app.ui.search

import com.streamo.app.data.remote.dto.TmdbItem

/** Campo di ordinamento per la sezione Cerca.
 *  - [movieKey]/[tvKey] sono i valori `sort_by` usati dai discover endpoint di TMDB
 *    (diversi per Anno: `primary_release_date` movie vs `first_air_date` tv). */
enum class SortField(val movieKey: String, val tvKey: String, val label: String) {
    POPULARITY("popularity", "popularity", "Popolarità"),
    RATING("vote_average", "vote_average", "Valutazione"),
    VOTE_COUNT("vote_count", "vote_count", "Numero voti"),
    YEAR("primary_release_date", "first_air_date", "Anno");

    companion object {
        fun fromKey(s: String?): SortField = entries.firstOrNull { it.name == s } ?: POPULARITY
    }
}

/** Direzione di ordinamento. [suffix] è il suffisso `sort_by` di TMDB (`asc`/`desc`). */
enum class SortOrder(val suffix: String, val label: String) {
    ASC("asc", "Crescente"),
    DESC("desc", "Decrescente");

    companion object {
        fun fromKey(s: String?): SortOrder = entries.firstOrNull { it.name == s } ?: DESC
    }
}

/** Costruisce il token `sort_by` per un discover endpoint, es. `"vote_average.desc"`. */
fun sortKey(field: SortField, order: SortOrder, mediaType: String): String {
    val key = if (mediaType == "tv") field.tvKey else field.movieKey
    return "$key.${order.suffix}"
}

/** Riordina una lista di [TmdbItem] lato client. I valori null finiscono sempre in fondo
 *  (nulls-last) indipendentemente dalla direzione. Usato per il path text-search
 *  (TMDB search non supporta `sort_by`) e per il merge del mix "all" nel path browse. */
fun sortItems(items: List<TmdbItem>, field: SortField, order: SortOrder): List<TmdbItem> {
    val dir = if (order == SortOrder.DESC) -1 else 1
    return items.sortedWith { a, b ->
        when (field) {
            SortField.YEAR -> compareNullableDir(a.primaryDate, b.primaryDate, dir)
            else -> compareNullableDir(numKey(a, field), numKey(b, field), dir)
        }
    }
}

private fun numKey(item: TmdbItem, field: SortField): Double? = when (field) {
    SortField.POPULARITY -> item.popularity
    SortField.RATING -> item.voteAverage
    SortField.VOTE_COUNT -> item.voteCount?.toDouble()
    SortField.YEAR -> null
}

/** Nulls-last in entrambe le direzioni: la direzione applica solo al confronto non-null. */
private fun <T : Comparable<T>> compareNullableDir(a: T?, b: T?, dir: Int): Int = when {
    a == null && b == null -> 0
    a == null -> 1
    b == null -> -1
    else -> a.compareTo(b) * dir
}