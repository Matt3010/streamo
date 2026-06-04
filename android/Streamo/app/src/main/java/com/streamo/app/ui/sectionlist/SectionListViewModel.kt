package com.streamo.app.ui.sectionlist

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.toRoute
import com.streamo.app.data.remote.dto.TmdbItem
import com.streamo.app.navigation.NavRoutes
import com.streamo.app.tmdb.TMDBClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SectionListViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val client: TMDBClient
) : ViewModel() {

    private val _title = MutableStateFlow("")
    val title: StateFlow<String> = _title

    private val _items = MutableStateFlow<List<TmdbItem>>(emptyList())
    val items: StateFlow<List<TmdbItem>> = _items

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading

    private val _hasMore = MutableStateFlow(true)
    val hasMore: StateFlow<Boolean> = _hasMore

    private var currentPage = 1
    private val endpoint: String
    val mediaType: String

    init {
        val route = savedStateHandle.toRoute<NavRoutes.SectionList>()
        _title.value = route.title
        endpoint = route.endpoint
        mediaType = route.mediaType
        loadMore()
    }

    fun loadMore() {
        if (_isLoading.value || !_hasMore.value) return
        viewModelScope.launch {
            _isLoading.value = true
            try {
                val newItems = client.list(endpoint = endpoint, page = currentPage)
                if (newItems.isEmpty()) {
                    _hasMore.value = false
                } else {
                    _items.value = _items.value + newItems
                    currentPage++
                }
            } catch (_: Exception) {
                _hasMore.value = false
            } finally {
                _isLoading.value = false
            }
        }
    }
}
