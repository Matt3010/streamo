package com.streamo.app.ui.history

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.streamo.app.data.local.entity.HistoryEntry
import com.streamo.app.data.local.entity.ProgressEntry
import com.streamo.app.data.repository.AppRepository
import com.streamo.app.util.TVLogic
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.util.Calendar
import javax.inject.Inject

/** Type filter for the history page (port of iOS TypeFilter). */
enum class HistoryFilter { ALL, TV, MOVIE }

data class HistoryItem(
    val entry: HistoryEntry,
    val progress: ProgressEntry?,
    /** "Completato" / null — the grey status line under the card. */
    val statusText: String?,
    /** Seconds to use for the frozen progress bar on this history row. */
    val snapshotPosition: Double,
    /** Duration to use for the frozen progress bar on this history row. */
    val snapshotDuration: Double
)

data class HistorySection(
    val key: String,
    val title: String,
    val summary: String,
    val items: List<HistoryItem>
)

data class HistoryUiState(
    val totalWatchSeconds: Double = 0.0,
    val sections: List<HistorySection> = emptyList(),
    /** Whole history is empty (no entry at all). */
    val isEmpty: Boolean = true,
    /** History has entries but the current filter yields nothing. */
    val filteredEmpty: Boolean = false
)

@HiltViewModel
class HistoryViewModel @Inject constructor(
    private val repository: AppRepository
) : ViewModel() {

    private val filter = MutableStateFlow(HistoryFilter.ALL)
    val selectedFilter: StateFlow<HistoryFilter> = filter

    val state: StateFlow<HistoryUiState> = combine(
        repository.history(),
        repository.progress(),
        filter
    ) { entries, progressList, activeFilter ->
        val progressByKey = progressList.associateBy { coordinate(it.tmdbId, it.mediaType, it.season, it.episode) }

        fun progressFor(e: HistoryEntry): ProgressEntry? =
            progressByKey[coordinate(e.tmdbId, e.mediaType, e.season, e.episode)]

        // Count each watched coordinate once, matching iOS totalWatchSeconds.
        val countedCoordinates = mutableSetOf<String>()
        val totalWatch = entries.sumOf { e ->
            val key = coordinate(e.tmdbId, e.mediaType, e.season, e.episode)
            if (!countedCoordinates.add(key)) return@sumOf 0.0
            val p = progressFor(e) ?: return@sumOf 0.0
            watchTimeSeconds(p.positionSeconds, p.durationSeconds)
        }

        val filtered = when (activeFilter) {
            HistoryFilter.ALL -> entries
            HistoryFilter.TV -> entries.filter { it.mediaType == "tv" }
            HistoryFilter.MOVIE -> entries.filter { it.mediaType == "movie" }
        }

        val sections = buildSections(filtered, ::progressFor)

        HistoryUiState(
            totalWatchSeconds = totalWatch,
            sections = sections,
            isEmpty = entries.isEmpty(),
            filteredEmpty = entries.isNotEmpty() && filtered.isEmpty()
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), HistoryUiState())

    fun setFilter(value: HistoryFilter) {
        filter.value = value
    }

    fun remove(entry: HistoryEntry) {
        viewModelScope.launch {
            repository.removeFromHistory(entry)
        }
    }

    // MARK: - Sections (port of buildHistorySections)

    private fun buildSections(
        entries: List<HistoryEntry>,
        progressFor: (HistoryEntry) -> ProgressEntry?
    ): List<HistorySection> {
        val order = mutableListOf<String>()
        val grouped = mutableMapOf<String, MutableList<HistoryEntry>>()
        for (e in entries) {
            val key = sectionKey(e.watchedAt)
            grouped.getOrPut(key) { order.add(key); mutableListOf() }.add(e)
        }
        return order.map { key ->
            val items = grouped[key].orEmpty().map { entry ->
                val p = progressFor(entry)
                // Prefer the row's own snapshot for the card, fall back to live progress for legacy rows.
                val snapshotPosition = if (entry.durationSeconds > 0) entry.progressSeconds else p?.positionSeconds ?: 0.0
                val snapshotDuration = if (entry.durationSeconds > 0) entry.durationSeconds else p?.durationSeconds ?: 0.0
                val completed = snapshotDuration > 0 && snapshotPosition >= snapshotDuration * TVLogic.WATCHED_THRESHOLD
                HistoryItem(
                    entry = entry,
                    progress = p,
                    statusText = if (completed) "Completato" else null,
                    snapshotPosition = snapshotPosition,
                    snapshotDuration = snapshotDuration
                )
            }
            HistorySection(
                key = key,
                title = sectionTitle(key),
                summary = summary(items),
                items = items
            )
        }
    }

    private fun sectionKey(watchedAt: Long): String {
        val cal = Calendar.getInstance()
        val today = startOfDay(cal.timeInMillis)
        val day = startOfDay(watchedAt)
        val diffDays = ((today - day) / DAY_MS).toInt()
        if (diffDays <= 0) return "today"
        if (diffDays == 1) return "yesterday"
        if (diffDays < 7) return "week"
        val now = Calendar.getInstance()
        val then = Calendar.getInstance().apply { timeInMillis = watchedAt }
        if (now.get(Calendar.YEAR) == then.get(Calendar.YEAR) &&
            now.get(Calendar.MONTH) == then.get(Calendar.MONTH)
        ) return "month"
        return "older:${then.get(Calendar.YEAR)}-${then.get(Calendar.MONTH)}"
    }

    private fun startOfDay(millis: Long): Long {
        val cal = Calendar.getInstance().apply {
            timeInMillis = millis
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        return cal.timeInMillis
    }

    private fun sectionTitle(key: String): String = when (key) {
        "today" -> "Oggi"
        "yesterday" -> "Ieri"
        "week" -> "Questa settimana"
        "month" -> "Questo mese"
        else -> "Prima"
    }

    /** Port of the web historySectionSummary: count meaningful rows only. */
    private fun summary(items: List<HistoryItem>): String {
        var episodes = 0
        var movies = 0
        for (item in items) {
            val pos = item.snapshotPosition
            val dur = item.snapshotDuration
            val completed = dur > 0 && pos >= dur * TVLogic.WATCHED_THRESHOLD
            if (item.entry.mediaType == "tv") {
                if (completed || pos > 15) episodes++
            } else if (completed) {
                movies++
            }
        }
        val parts = mutableListOf<String>()
        if (episodes > 0) parts.add(if (episodes == 1) "1 episodio visto" else "$episodes episodi visti")
        if (movies > 0) parts.add(if (movies == 1) "1 film completato" else "$movies film completati")
        return parts.joinToString(" • ")
    }

    companion object {
        private const val DAY_MS = 24L * 60 * 60 * 1000

        private fun coordinate(tmdbId: Int, mediaType: String, season: Int, episode: Int): String =
            "$mediaType-$tmdbId-$season-$episode"

        /** Port of Library.watchTimeSeconds. */
        private fun watchTimeSeconds(position: Double, duration: Double): Double = when {
            duration > 0 && position >= duration * TVLogic.WATCHED_THRESHOLD -> duration
            position > 0 && duration > 0 -> minOf(position, duration)
            position > 0 -> position
            else -> 0.0
        }

        /** Human watch-time, e.g. "12 h 30 min" / "45 min" (port of Format.watchTime). */
        fun formatWatchTime(seconds: Double): String {
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
}
