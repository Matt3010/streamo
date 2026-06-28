package com.streamo.provider.streamingcommunity

import java.util.Calendar

/**
 * Minimal date helper copied from the host's `util.TVLogic` — the extension only
 * needs to skip searching for unreleased titles, so we keep just this slice
 * rather than depending on host utilities.
 */
object ScDateUtil {
    fun isFutureDate(dateStr: String?): Boolean {
        val parts = ymd(dateStr) ?: return false
        val cal = Calendar.getInstance()
        val today = cal.apply {
            set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }.time
        val date = cal.apply {
            set(parts.first, parts.second - 1, parts.third, 0, 0, 0)
            set(Calendar.MILLISECOND, 0)
        }.time
        return date > today
    }

    private fun ymd(s: String?): Triple<Int, Int, Int>? {
        if (s.isNullOrEmpty() || s.length < 10) return null
        val parts = s.substring(0, 10).split("-")
        if (parts.size != 3) return null
        val y = parts[0].toIntOrNull() ?: return null
        val m = parts[1].toIntOrNull() ?: return null
        val d = parts[2].toIntOrNull() ?: return null
        return Triple(y, m, d)
    }
}
