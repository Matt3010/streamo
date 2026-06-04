package com.streamo.app.ui.home

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.streamo.app.data.local.entity.ProgressEntry
import com.streamo.app.data.local.entity.WatchlistEntry
import com.streamo.app.data.remote.dto.TmdbItem
import com.streamo.app.data.repository.StreamoRepository
import com.streamo.app.tmdb.TMDBClient
import com.streamo.app.util.TVLogic
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val client: TMDBClient,
    private val repository: StreamoRepository
) : ViewModel() {

    var rows by mutableStateOf(mapOf<String, List<TmdbItem>>())
        private set

    var isLoading by mutableStateOf(false)
        private set

    var errorMessage by mutableStateOf<String?>(null)
        private set

    private val _watchlist = MutableStateFlow<List<WatchlistEntry>>(emptyList())
    val watchlist: StateFlow<List<WatchlistEntry>> = _watchlist.asStateFlow()

    private val _progress = MutableStateFlow<List<ProgressEntry>>(emptyList())
    val progress: StateFlow<List<ProgressEntry>> = _progress.asStateFlow()

    private var hasLoaded = false
    private val pages = mutableMapOf<String, Int>()
    private val loadingMore = mutableMapOf<String, Boolean>()

    init {
        viewModelScope.launch {
            repository.watchlist().collect { _watchlist.value = it }
        }
        viewModelScope.launch {
            repository.progress().collect { list ->
                _progress.value = list
                    .groupBy { it.tmdbId to it.mediaType }
                    .map { (_, entries) -> entries.maxByOrNull { it.updatedAt }!! }
                    .filter { entry ->
                        entry.durationSeconds <= 0 ||
                            entry.positionSeconds < entry.durationSeconds * TVLogic.WATCHED_THRESHOLD
                    }
                    .sortedByDescending { it.updatedAt }
            }
        }
    }

    fun loadIfNeeded() {
        if (hasLoaded) return
        hasLoaded = true
        reload()
    }

    fun reload() {
        viewModelScope.launch {
            isLoading = true
            errorMessage = null
            val newRows = mutableMapOf<String, List<TmdbItem>>()
            val deferreds = HomeSections.all.map { section ->
                async {
                    val items = try {
                        client.list(section.endpoint)
                    } catch (_: Exception) {
                        emptyList()
                    }
                    section.id to items
                }
            }
            deferreds.awaitAll().forEach { (id, items) ->
                newRows[id] = items
                pages[id] = 1
            }
            rows = newRows
            if (newRows.values.none { it.isNotEmpty() }) {
                errorMessage = if (client.apiKey().isNotBlank()) {
                    "Impossibile caricare il catalogo. Controlla la connessione."
                } else {
                    "Aggiungi la tua chiave API TMDB nelle Impostazioni."
                }
            }
            isLoading = false
        }
    }

    fun loadMoreFor(section: HomeSection) {
        if (loadingMore[section.id] == true) return
        loadingMore[section.id] = true
        viewModelScope.launch {
            val currentPage = pages.getOrDefault(section.id, 1)
            val newItems = try {
                client.list(section.endpoint, page = currentPage + 1)
            } catch (_: Exception) {
                emptyList()
            }
            if (newItems.isNotEmpty()) {
                rows = rows.toMutableMap().apply {
                    this[section.id] = (this[section.id] ?: emptyList()) + newItems
                }
                pages[section.id] = currentPage + 1
            }
            loadingMore[section.id] = false
        }
    }

    fun itemsFor(section: HomeSection): List<TmdbItem> = rows[section.id].orEmpty()

    fun removeProgress(id: Int) {
        viewModelScope.launch {
            repository.deleteProgress(id)
        }
    }
}
