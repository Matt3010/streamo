package com.streamo.app.data.local.entity

import androidx.room.Entity
import java.util.Calendar

/**
 * A watched-history snapshot row.
 *
 * The primary key is composite: one row per day for each episode/movie.
 * Re-watching the same episode on the same day updates the existing row
 * (REPLACE semantics). Re-watching on a different day creates a new row,
 * matching the iOS behavior.
 *
 * [progressSeconds] and [durationSeconds] are snapshots of the matching
 * [ProgressEntry] at the moment this row was recorded, so the history card
 * can show the progress bar frozen to that day.
 */
@Entity(
    tableName = "history",
    primaryKeys = ["tmdbId", "mediaType", "season", "episode", "watchedDay"]
)
data class HistoryEntry(
    val tmdbId: Int,
    val mediaType: String,
    val title: String,
    val posterPath: String?,
    val season: Int = 0,
    val episode: Int = 0,
    val watchedAt: Long = System.currentTimeMillis(),
    /** Start-of-day timestamp used to de-duplicate same-episode rows within one day. */
    val watchedDay: Long = startOfDay(watchedAt),
    /** Snapshot of the cumulative position (seconds) when this row was saved. */
    val progressSeconds: Double = 0.0,
    /** Snapshot of the total duration (seconds) when this row was saved. */
    val durationSeconds: Double = 0.0
) {
    companion object {
        /** Local-time start of day for the given timestamp (port of iOS logic). */
        fun startOfDay(millis: Long): Long {
            val cal = Calendar.getInstance().apply {
                timeInMillis = millis
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }
            return cal.timeInMillis
        }
    }
}
