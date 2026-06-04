package com.streamo.app.ui.continuewatching

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.streamo.app.data.local.entity.ProgressEntry
import com.streamo.app.data.repository.StreamoRepository
import com.streamo.app.util.TVLogic
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ContinueWatchingViewModel @Inject constructor(
    private val repository: StreamoRepository
) : ViewModel() {

    val items: StateFlow<List<ProgressEntry>> = repository.progress()
        .map { list ->
            list
                .groupBy { it.tmdbId to it.mediaType }
                .map { (_, entries) -> entries.maxByOrNull { it.updatedAt }!! }
                .filter { entry ->
                    entry.durationSeconds <= 0 ||
                        entry.positionSeconds < entry.durationSeconds * TVLogic.WATCHED_THRESHOLD
                }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun remove(id: Int) {
        viewModelScope.launch {
            repository.deleteProgress(id)
        }
    }
}
