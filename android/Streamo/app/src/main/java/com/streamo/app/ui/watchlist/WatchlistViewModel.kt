package com.streamo.app.ui.watchlist

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.streamo.app.data.local.entity.ProgressEntry
import com.streamo.app.data.local.entity.WatchlistEntry
import com.streamo.app.data.repository.AppRepository
import com.streamo.app.util.TVLogic
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Stato di visione derivato dal progresso (port dei filtri watchlist iOS). */
enum class WatchStatus { TODO, IN_PROGRESS, DONE }

enum class WatchlistType { ALL, TV, MOVIE }
enum class WatchlistStatusFilter { ALL, TODO, IN_PROGRESS, DONE }

data class WatchlistItem(
    val entry: WatchlistEntry,
    val progress: ProgressEntry?,
    val status: WatchStatus,
    /** False per titoli derivati solo dal progress (non flaggati in watchlist):
     *  la card non mostra "Rimuovi dalla lista" perché non c'è una entry da toglere. */
    val inWatchlist: Boolean = true
)

@HiltViewModel
class WatchlistViewModel @Inject constructor(
    private val repository: AppRepository
) : ViewModel() {

    private val _selectedType = MutableStateFlow(WatchlistType.ALL)
    val selectedType: StateFlow<WatchlistType> = _selectedType

    private val _selectedStatus = MutableStateFlow(WatchlistStatusFilter.ALL)
    val selectedStatus: StateFlow<WatchlistStatusFilter> = _selectedStatus

    private val allItems: StateFlow<List<WatchlistItem>> = combine(
        repository.watchlist(),
        repository.progress()
    ) { entries, progressList ->
        // Titoli flaggati in watchlist (hanno stato TODO anche senza progress).
        val watchlistKeys = entries
            .map { watchKey(it.tmdbId, it.mediaType) }
            .toHashSet()
        val fromWatchlist = entries.map { entry ->
            val latest = progressList
                .filter { it.tmdbId == entry.tmdbId && it.mediaType == entry.mediaType }
                .maxByOrNull { it.updatedAt }
            WatchlistItem(entry, latest, statusOf(latest))
        }
        // Titoli guardati MAI flaggati in watchlist: derivano una entry fittizia
        // dal progress più recente, così compaiono nei filtri "In corso"/"Visto".
        val fromProgress = progressList
            .filter { watchKey(it.tmdbId, it.mediaType) !in watchlistKeys }
            .groupBy { watchKey(it.tmdbId, it.mediaType) }
            .map { (_, rows) ->
                val latest = rows.maxByOrNull { it.updatedAt }!!
                val entry = WatchlistEntry(
                    tmdbId = latest.tmdbId,
                    mediaType = latest.mediaType,
                    title = latest.title,
                    posterPath = latest.posterPath
                )
                WatchlistItem(entry, latest, statusOfProgressOnly(latest), inWatchlist = false)
            }
            .sortedByDescending { it.progress?.updatedAt ?: 0L }
        fromWatchlist + fromProgress
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    private fun watchKey(tmdbId: Int, mediaType: String) = "$tmdbId|$mediaType"

    val items: StateFlow<List<WatchlistItem>> = combine(
        allItems,
        _selectedType,
        _selectedStatus
    ) { list, type, status ->
        list.filter { item ->
            val typeOk = when (type) {
                WatchlistType.ALL -> true
                WatchlistType.TV -> item.entry.mediaType == "tv"
                WatchlistType.MOVIE -> item.entry.mediaType == "movie"
            }
            val statusOk = when (status) {
                WatchlistStatusFilter.ALL -> true
                WatchlistStatusFilter.TODO -> item.status == WatchStatus.TODO
                WatchlistStatusFilter.IN_PROGRESS -> item.status == WatchStatus.IN_PROGRESS
                WatchlistStatusFilter.DONE -> item.status == WatchStatus.DONE
            }
            typeOk && statusOk
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    private fun statusOf(progress: ProgressEntry?): WatchStatus {
        if (progress == null || progress.durationSeconds <= 0) return WatchStatus.TODO
        return if (progress.positionSeconds >= progress.durationSeconds * TVLogic.WATCHED_THRESHOLD) {
            WatchStatus.DONE
        } else {
            WatchStatus.IN_PROGRESS
        }
    }

    /**
     * Status per titoli NON in watchlist (derivati solo dal progress). Mai TODO:
     * "Da guardare" ha senso solo per entry flaggate; un titolo con progress è
     * stato aperto → almeno IN_PROGRESS, oppure DONE se oltre la soglia.
     */
    private fun statusOfProgressOnly(progress: ProgressEntry): WatchStatus =
        if (progress.durationSeconds > 0 &&
            progress.positionSeconds >= progress.durationSeconds * TVLogic.WATCHED_THRESHOLD
        ) {
            WatchStatus.DONE
        } else {
            WatchStatus.IN_PROGRESS
        }

    fun setType(type: WatchlistType) {
        _selectedType.value = type
    }

    fun setStatus(status: WatchlistStatusFilter) {
        _selectedStatus.value = status
    }

    fun remove(id: Int, mediaType: String) {
        viewModelScope.launch {
            repository.removeFromWatchlist(id, mediaType)
        }
    }
}
