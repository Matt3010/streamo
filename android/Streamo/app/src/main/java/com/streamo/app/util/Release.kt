package com.streamo.app.util

import com.streamo.app.data.remote.dto.TmdbItem
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

object Release {
    private val calendar: Calendar get() = Calendar.getInstance()

    private val longFmt = SimpleDateFormat("d MMMM yyyy", Locale.ITALIAN)
    private val shortFmt = SimpleDateFormat("d MMM", Locale.ITALIAN)

    fun parseDate(s: String?): Date? {
        if (s.isNullOrEmpty() || s.length < 10) return null
        val p = s.substring(0, 10).split("-")
        if (p.size != 3) return null
        val y = p[0].toIntOrNull() ?: return null
        val m = p[1].toIntOrNull() ?: return null
        val d = p[2].toIntOrNull() ?: return null
        return calendar.apply { set(y, m - 1, d, 0, 0, 0); set(Calendar.MILLISECOND, 0) }.time
    }

    fun isFuture(d: Date): Boolean {
        val today = calendar.apply { set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }.time
        return d > today
    }

    fun longDate(d: Date): String = longFmt.format(d)
    fun shortDate(d: Date): String = shortFmt.format(d)

    fun watchlistMeta(item: TmdbItem, type: String): Pair<Boolean, String?> {
        val titleDate = if (type == "movie") item.releaseDate else item.firstAirDate
        val d = parseDate(titleDate)
        if (d != null && isFuture(d)) {
            return Pair(true, if (type == "movie") "Esce il ${longDate(d)}" else "Dal ${longDate(d)}")
        }
        if (type == "tv") {
            val nd = parseDate(item.nextEpisodeToAir?.airDate)
            if (nd != null && isFuture(nd)) {
                return Pair(false, "Nuovo ep. ${shortDate(nd)}")
            }
        }
        return Pair(false, null)
    }

    fun isUpcoming(item: TmdbItem, type: String): Boolean = watchlistMeta(item, type).first

    fun upcomingBadge(item: TmdbItem, type: String): String? {
        if (!isUpcoming(item, type)) return null
        return if (type == "movie") "Prossimamente" else "Nuova serie"
    }

    fun compactStatus(item: TmdbItem, type: String): String? {
        val meta = watchlistMeta(item, type)
        if (meta.second != null) return meta.second
        if (type != "tv") return null
        val next = findNextSeason(item) ?: return null
        return "Stagione ${next.first} il ${shortDate(next.second)}"
    }

    fun fullStatus(item: TmdbItem, type: String): String {
        if (type == "tv") {
            val d = parseDate(item.firstAirDate)
            if (d != null && isFuture(d)) return "Nuova serie dal ${longDate(d)}."
        }
        if (type == "movie") {
            val d = parseDate(item.releaseDate)
            if (d != null && isFuture(d)) return "Esce il ${longDate(d)}."
            return ""
        }
        val nea = item.nextEpisodeToAir
        val nd = parseDate(nea?.airDate)
        if (nd != null && isFuture(nd)) {
            val s = nea?.seasonNumber?.toString() ?: "?"
            val e = nea?.episodeNumber?.toString() ?: "?"
            return "Prossimo episodio: S$s E$e in uscita il ${longDate(nd)}."
        }
        val next = findNextSeason(item)
        if (next != null) {
            return "Prossima stagione: Stagione ${next.first} in uscita il ${longDate(next.second)}."
        }
        if (item.status == "Ended" || item.status == "Canceled") return "Serie conclusa."
        return ""
    }

    private fun findNextSeason(item: TmdbItem): Pair<Int, Date>? {
        val lastSeason = TVLogic.effectiveLastEpisode(item)?.first ?: 0
        return item.seasons.orEmpty()
            .filter { it.seasonNumber > 0 }
            .mapNotNull { s ->
                val d = parseDate(s.airDate)
                if (d != null && s.seasonNumber > lastSeason) Pair(s.seasonNumber, d) else null
            }
            .sortedBy { it.second }
            .firstOrNull { isFuture(it.second) }
    }
}
