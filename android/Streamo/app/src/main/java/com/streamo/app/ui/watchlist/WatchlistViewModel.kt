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
    val status: WatchStatus
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
        entries.map { entry ->
            val latest = progressList
                .filter { it.tmdbId == entry.tmdbId && it.mediaType == entry.mediaType }
                .maxByOrNull { it.updatedAt }
            WatchlistItem(entry, latest, statusOf(latest))
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

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

    fun setType(type: WatchlistType) {
        _selectedType.value = type
    }

    fun setStatus(status: WatchlistStatusFilter) {
        _selectedStatus.value = status
    }

    fun remove(id: Int) {
        viewModelScope.launch {
            repository.removeFromWatchlist(id)
        }
    }
}
