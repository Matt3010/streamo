package com.streamo.app.ui.watchlist

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.streamo.app.data.local.entity.ProgressEntry
import com.streamo.app.data.local.entity.WatchlistEntry
import com.streamo.app.data.repository.StreamoRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class WatchlistItem(
    val entry: WatchlistEntry,
    val progress: ProgressEntry?
)

@HiltViewModel
class WatchlistViewModel @Inject constructor(
    private val repository: StreamoRepository
) : ViewModel() {

    val items: StateFlow<List<WatchlistItem>> = combine(
        repository.watchlist(),
        repository.progress()
    ) { entries, progressList ->
        entries.map { entry ->
            val latest = progressList
                .filter { it.tmdbId == entry.tmdbId && it.mediaType == entry.mediaType }
                .maxByOrNull { it.updatedAt }
            WatchlistItem(entry, latest)
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun remove(id: Int) {
        viewModelScope.launch {
            repository.removeFromWatchlist(id)
        }
    }
}
