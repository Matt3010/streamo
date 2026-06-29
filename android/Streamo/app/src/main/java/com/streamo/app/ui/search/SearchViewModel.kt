package com.streamo.app.ui.search

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.streamo.app.data.local.entity.SearchHistoryEntry
import com.streamo.app.data.preferences.SettingsDataStore
import com.streamo.app.data.remote.dto.TmdbGenre
import com.streamo.app.data.remote.dto.TmdbItem
import com.streamo.app.data.repository.AppRepository
import com.streamo.app.tmdb.TMDBClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SearchViewModel @Inject constructor(
    private val client: TMDBClient,
    private val repository: AppRepository,
    private val settings: SettingsDataStore
) : ViewModel() {

    val showCardInfo: StateFlow<Boolean> = settings.showCardInfo
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), true)

    var query by mutableStateOf("")
        private set

    var results = mutableStateListOf<TmdbItem>()
        private set

    var isSearching by mutableStateOf(false)
        private set

    var hasMore by mutableStateOf(true)
        private set

    var searchHistory = mutableStateListOf<String>()
        private set

    // Filtri
    var mediaTypeFilter by mutableStateOf("all")
        private set

    /** Generi selezionati (multi-selezione). */
    var selectedGenreIds = mutableStateListOf<Int>()
        private set

    var availableGenres = mutableStateListOf<TmdbGenre>()
        private set

    var isSearchFieldFocused by mutableStateOf(false)
        private set

    // Ordinamento (persistito in SettingsDataStore). Usato sia come snapshot per
    // fetch/applySort sia come stato osservato dalla UI per evidenziare il chip.
    var sortField by mutableStateOf(SortField.POPULARITY)
        private set

    var sortOrder by mutableStateOf(SortOrder.DESC)
        private set

    private var currentPage = 1
    private var searchJob: Job? = null

    /** Nomi dei generi attualmente selezionati, nella lingua dell’API. */
    val selectedGenreNames: List<String>
        get() = selectedGenreIds.mapNotNull { id ->
            availableGenres.firstOrNull { it.id == id }?.name
        }

    init {
        viewModelScope.launch {
            repository.searchHistory().collect { entries ->
                searchHistory.clear()
                searchHistory.addAll(entries.map { it.query })
            }
        }
        viewModelScope.launch {
            try {
                val genres = client.genres()
                availableGenres.clear()
                availableGenres.addAll(genres)
            } catch (_: Exception) { }
        }
        viewModelScope.launch {
            settings.searchSortField.collect { sortField = SortField.fromKey(it) }
        }
        viewModelScope.launch {
            settings.searchSortOrder.collect { sortOrder = SortOrder.fromKey(it) }
        }
    }

    fun onFocusChange(focused: Boolean) {
        isSearchFieldFocused = focused
    }

    fun onQueryChange(newQuery: String) {
        query = newQuery
        searchJob?.cancel()
        val trimmed = newQuery.trim()

        // Query < 2: mostra cronologia (se focus) o browse (se filtri attivi)
        if (trimmed.length < 2) {
            results.clear()
            isSearching = false
            hasMore = true
            currentPage = 1
            // Se filtri attivi, carica browse
            if (hasActiveFilters()) {
                loadBrowse(page = 1)
            }
            return
        }

        // Query ≥ 2: cerca
        searchJob = viewModelScope.launch {
            delay(350)
            isSearching = true
            results.clear()
            currentPage = 1
            hasMore = true
            val found = try {
                search(trimmed, page = 1)
            } catch (_: Exception) {
                emptyList()
            }
            results.addAll(found)
            hasMore = found.isNotEmpty()
            applySort()
            isSearching = false
        }
    }

    fun onMediaTypeFilterChange(type: String) {
        if (mediaTypeFilter == type) return
        mediaTypeFilter = type
        selectedGenreIds.clear()
        reSearch()
    }

    fun toggleGenre(genreId: Int) {
        if (selectedGenreIds.contains(genreId)) {
            selectedGenreIds.remove(genreId)
        } else {
            selectedGenreIds.add(genreId)
        }
        reSearch()
    }

    fun setSelectedGenres(ids: Collection<Int>) {
        val newSet = ids.toSet()
        if (selectedGenreIds.toSet() == newSet) return
        selectedGenreIds.clear()
        selectedGenreIds.addAll(newSet)
        reSearch()
    }

    fun clearGenreFilters() {
        if (selectedGenreIds.isEmpty()) return
        selectedGenreIds.clear()
        reSearch()
    }

    /** Cambia ordinamento: persiste in DataStore e applica. Text-search → riordina gli
     *  elementi già caricati (TMDB search non supporta `sort_by`); browse → re-fetch
     *  con nuovo `sort_by` server-side; nessun risultato → aggiorna solo la preferenza. */
    fun onSortChange(field: SortField, order: SortOrder) {
        if (sortField == field && sortOrder == order) return
        sortField = field
        sortOrder = order
        viewModelScope.launch { settings.setSearchSort(field.name, order.name) }
        val trimmed = query.trim()
        when {
            trimmed.length >= 2 -> applySort()
            hasActiveFilters() -> reSearch()
        }
    }

    /** Riordina `results` in-place (nulls-last). Usato per il path text-search e per
     *  applicare un cambio di sort senza re-fetch quando la query è attiva. */
    private fun applySort() {
        if (results.isEmpty()) return
        val sorted = sortItems(results.toList(), sortField, sortOrder)
        results.clear()
        results.addAll(sorted)
    }

    private fun hasActiveFilters(): Boolean {
        return mediaTypeFilter != "all" || selectedGenreIds.isNotEmpty()
    }

    private fun reSearch() {
        searchJob?.cancel()
        val trimmed = query.trim()
        if (trimmed.length < 2) {
            results.clear()
            currentPage = 1
            hasMore = true
            if (hasActiveFilters()) {
                loadBrowse(page = 1)
            } else {
                results.clear()
                hasMore = false
            }
            return
        }
        searchJob = viewModelScope.launch {
            isSearching = true
            results.clear()
            currentPage = 1
            hasMore = true
            val found = try {
                search(trimmed, page = 1)
            } catch (_: Exception) {
                emptyList()
            }
            results.addAll(found)
            hasMore = found.isNotEmpty()
            applySort()
            isSearching = false
        }
    }

    private fun loadBrowse(page: Int) {
        searchJob = viewModelScope.launch {
            isSearching = true
            results.clear()
            hasMore = true
            val found = try {
                browse(page = page)
            } catch (_: Exception) {
                emptyList()
            }
            results.addAll(found)
            hasMore = found.isNotEmpty()
            isSearching = false
        }
    }

    fun loadMore() {
        if (isSearching || !hasMore) return
        val trimmed = query.trim()
        if (trimmed.length < 2 && !hasActiveFilters()) return
        viewModelScope.launch {
            isSearching = true
            currentPage++
            val found = try {
                if (trimmed.length >= 2) {
                    search(trimmed, page = currentPage)
                } else {
                    browse(page = currentPage)
                }
            } catch (_: Exception) {
                emptyList()
            }
            if (found.isEmpty()) {
                hasMore = false
            } else {
                results.addAll(found)
                if (trimmed.length >= 2) applySort()
            }
            isSearching = false
        }
    }

    private suspend fun browse(page: Int): List<TmdbItem> {
        val genreFilter = selectedGenreIds.toSet().takeIf { it.isNotEmpty() }
        return when (mediaTypeFilter) {
            "movie" -> client.browseMovies(
                page = page,
                genreIds = genreFilter,
                sortBy = sortKey(sortField, sortOrder, "movie")
            )
            "tv" -> client.browseTv(
                page = page,
                genreIds = genreFilter,
                sortBy = sortKey(sortField, sortOrder, "tv")
            )
            else -> {
                // "all": discover entrambi (ciascuno sortato server-side con la sua
                // sortKey) e merge. Il mix "all" senza generi mantiene il random del
                // default (popolarità desc) per UX; con altro sort si ordina client-side.
                val movies = client.browseMovies(
                    page = page,
                    genreIds = genreFilter,
                    sortBy = sortKey(sortField, sortOrder, "movie")
                )
                val tv = client.browseTv(
                    page = page,
                    genreIds = genreFilter,
                    sortBy = sortKey(sortField, sortOrder, "tv")
                )
                val merged = if (genreFilter != null) {
                    (movies + tv).filter { item ->
                        item.genreIds?.any { it in genreFilter } == true
                    }
                } else {
                    movies + tv
                }
                if (sortField == SortField.POPULARITY && sortOrder == SortOrder.DESC && genreFilter == null) {
                    merged.shuffled()
                } else {
                    sortItems(merged, sortField, sortOrder)
                }
            }
        }
    }

    private suspend fun search(query: String, page: Int): List<TmdbItem> {
        val genreFilter = selectedGenreIds.toSet().takeIf { it.isNotEmpty() }
        return when (mediaTypeFilter) {
            "movie" -> client.searchMovie(query, page = page, genreIds = genreFilter)
            "tv" -> client.searchTv(query, page = page, genreIds = genreFilter)
            else -> {
                val results = client.searchMulti(query, page = page)
                if (genreFilter != null) {
                    results.filter { item ->
                        item.genreIds?.any { it in genreFilter } == true
                    }
                } else {
                    results
                }
            }
        }
    }

    fun refresh() {
        if (query.trim().length >= 2) {
            onQueryChange(query)
        }
    }

    fun saveSearchQuery(q: String) {
        val trimmed = q.trim()
        if (trimmed.length < 2) return
        viewModelScope.launch {
            repository.addSearchQuery(SearchHistoryEntry(query = trimmed))
        }
    }

    fun deleteSearchQuery(q: String) {
        viewModelScope.launch {
            repository.removeSearchQuery(q)
        }
    }
}