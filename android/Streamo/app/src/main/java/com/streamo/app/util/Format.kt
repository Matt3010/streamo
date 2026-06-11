package com.streamo.app.util

object Format {

    fun time(seconds: Double): String {
        if (!seconds.isFinite() || seconds <= 0) return "0:00"
        val total = seconds.toInt()
        val h = total / 3600
        val m = (total % 3600) / 60
        val s = total % 60
        return if (h > 0) {
            String.format("%d:%02d:%02d", h, m, s)
        } else {
            String.format("%d:%02d", m, s)
        }
    }

    fun percent(position: Double, duration: Double): Double {
        if (duration <= 0) return 0.0
        return (position / duration * 100).coerceIn(0.0, 100.0)
    }

    fun viewedMinutes(position: Double?): String? {
        val p = position ?: return null
        if (p <= 0) return null
        val minutes = (p / 60).toInt().coerceAtLeast(1)
        return if (minutes == 1) "Visto 1 min" else "Visti $minutes min"
    }

    fun watchTime(seconds: Double): String {
        val totalMin = (seconds / 60).toInt()
        val h = totalMin / 60
        val m = totalMin % 60
        return if (h > 0) {
            if (m > 0) "$h h $m min" else "$h h"
        } else {
            "$m min"
        }
    }
}
