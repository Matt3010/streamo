package com.streamo.app.ui.search

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.streamo.app.data.local.entity.SearchHistoryEntry
import com.streamo.app.data.remote.dto.TmdbItem
import com.streamo.app.data.repository.StreamoRepository
import com.streamo.app.tmdb.TMDBClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SearchViewModel @Inject constructor(
    private val client: TMDBClient,
    private val repository: StreamoRepository
) : ViewModel() {

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

    private var currentPage = 1
    private var searchJob: Job? = null

    init {
        viewModelScope.launch {
            repository.searchHistory().collect { entries ->
                searchHistory.clear()
                searchHistory.addAll(entries.map { it.query })
            }
        }
    }

    fun onQueryChange(newQuery: String) {
        query = newQuery
        searchJob?.cancel()
        val trimmed = newQuery.trim()
        if (trimmed.length < 2) {
            results.clear()
            isSearching = false
            hasMore = true
            currentPage = 1
            return
        }
        searchJob = viewModelScope.launch {
            delay(350)
            isSearching = true
            results.clear()
            currentPage = 1
            hasMore = true
            val found = try {
                client.searchMulti(trimmed, page = 1)
            } catch (_: Exception) {
                emptyList()
            }
            results.addAll(found)
            hasMore = found.isNotEmpty()
            isSearching = false
        }
    }

    fun loadMore() {
        if (isSearching || !hasMore || query.trim().length < 2) return
        viewModelScope.launch {
            isSearching = true
            currentPage++
            val found = try {
                client.searchMulti(query.trim(), page = currentPage)
            } catch (_: Exception) {
                emptyList()
            }
            if (found.isEmpty()) {
                hasMore = false
            } else {
                results.addAll(found)
            }
            isSearching = false
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
