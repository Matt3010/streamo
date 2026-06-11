package com.streamo.app.ui.home

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.streamo.app.data.local.entity.ProgressEntry
import com.streamo.app.data.local.entity.WatchlistEntry
import com.streamo.app.data.remote.dto.TmdbItem
import androidx.compose.runtime.derivedStateOf
import com.streamo.app.data.preferences.SettingsDataStore
import com.streamo.app.data.repository.AppRepository
import com.streamo.app.tmdb.TMDBClient
import com.streamo.app.util.TVLogic
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val client: TMDBClient,
    private val repository: AppRepository,
    settings: SettingsDataStore
) : ViewModel() {

    val showCardInfo: StateFlow<Boolean> = settings.showCardInfo
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), true)

    var rows by mutableStateOf(mapOf<String, List<TmdbItem>>())
        private set

    /** Trending merge (movie+tv) per popolarità: primi 6 alimentano l'hero carousel. */
    val heroItems by derivedStateOf {
        trendingMerged().take(6)
    }

    /** Top 10 = trending merge, primi 10 esclusi gli item già nell'hero (no duplicati). */
    val top10 by derivedStateOf {
        val heroIds = heroItems.map { it.id to it.mediaType }.toSet()
        trendingMerged().filterNot { (it.id to it.mediaType) in heroIds }.take(10)
    }

    private fun trendingMerged(): List<TmdbItem> {
        val movies = (rows["movie-trending"].orEmpty()).map { it.withMediaType("movie") }
        val tv = (rows["tv-trending"].orEmpty()).map { it.withMediaType("tv") }
        return (movies + tv)
            .distinctBy { it.id to it.mediaType }
            .sortedByDescending { it.popularity ?: 0.0 }
    }

    private fun TmdbItem.withMediaType(type: String): TmdbItem =
        if (mediaType.isNullOrBlank()) copy(mediaType = type) else this

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

    /** Toggle watchlist per l'hero: aggiunge se assente, rimuove se già presente. */
    fun toggleWatchlist(item: TmdbItem) {
        viewModelScope.launch {
            if (repository.isInWatchlist(item.id)) {
                repository.removeFromWatchlist(item.id)
            } else {
                repository.addToWatchlist(
                    WatchlistEntry(
                        tmdbId = item.id,
                        mediaType = item.mediaType ?: "movie",
                        title = item.displayTitle,
                        posterPath = item.posterPath
                    )
                )
            }
        }
    }
}
