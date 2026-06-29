package com.streamo.app.ui.anime

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.streamo.app.data.local.entity.ProgressEntry
import com.streamo.app.data.repository.AppRepository
import com.streamo.app.provider.anime.AnimeUnityClient
import com.streamo.app.provider.anime.AUEpisode
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Dettaglio anime: finestre di 120 episodi (`/info_api` caps a 120). Port of iOS
 * `AnimeDetailView` + model. L'anime è una serie lineare (stagione 1 fittizia).
 */
@HiltViewModel
class AnimeDetailViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val animeClient: AnimeUnityClient,
    private val repository: AppRepository
) : ViewModel() {

    val animeId: Int = checkNotNull(savedStateHandle["animeId"])
    val slug: String? = savedStateHandle["slug"]
    val title: String? = savedStateHandle["title"]
    val poster: String? = savedStateHandle["poster"]

    // Metadati passati dalla card del catalogo (vuoti se aperto da "Continua a guardare").
    val type: String? = savedStateHandle["type"]
    val year: Int = savedStateHandle["year"] ?: 0
    val status: String? = savedStateHandle["status"]
    val isDubbed: Boolean = (savedStateHandle["dub"] ?: 0) == 1
    val plot: String? = savedStateHandle["plot"]

    var episodes by mutableStateOf<List<AUEpisode>>(emptyList())
        private set

    var totalEpisodes by mutableStateOf(0)
        private set

    /** Finestre "1-120 / 121-240 / …" costruite da [totalEpisodes]. */
    var windows by mutableStateOf<List<IntRange>>(emptyList())
        private set

    var selectedWindow by mutableStateOf(0..AnimeUnityClient.EPISODE_CHUNK)
        private set

    var isLoading by mutableStateOf(false)
        private set

    var errorMessage by mutableStateOf<String?>(null)
        private set

    private val _progressByEpisode = MutableStateFlow<Map<Int, ProgressEntry>>(emptyMap())
    val progressByEpisode: StateFlow<Map<Int, ProgressEntry>> = _progressByEpisode.asStateFlow()

    init {
        // Progresso per questo anime (tmdbId = id AnimeUnity, mediaType "anime").
        viewModelScope.launch {
            repository.progress().collect { list ->
                _progressByEpisode.value = list
                    .filter { it.tmdbId == animeId && it.mediaType == "anime" }
                    .associateBy { it.episode }
            }
        }
    }

    fun load() {
        viewModelScope.launch {
            isLoading = true
            errorMessage = null
            try {
                val page = animeClient.episodePage(animeId, start = 1, end = AnimeUnityClient.EPISODE_CHUNK)
                episodes = page.episodes
                totalEpisodes = page.total.coerceAtLeast(page.episodes.size)
                windows = buildWindows(totalEpisodes)
                selectedWindow = windows.firstOrNull() ?: (1..AnimeUnityClient.EPISODE_CHUNK)
            } catch (e: Exception) {
                errorMessage = "Impossibile caricare gli episodi. Riprova."
            }
            isLoading = false
        }
    }

    fun selectWindow(range: IntRange) {
        if (range == selectedWindow) return
        viewModelScope.launch {
            isLoading = true
            errorMessage = null
            try {
                val page = animeClient.episodePage(animeId, start = range.first, end = range.last)
                episodes = page.episodes
                selectedWindow = range
            } catch (e: Exception) {
                errorMessage = "Impossibile caricare gli episodi. Riprova."
            }
            isLoading = false
        }
    }

    private fun buildWindows(total: Int): List<IntRange> {
        if (total <= AnimeUnityClient.EPISODE_CHUNK) return emptyList()
        val windows = mutableListOf<IntRange>()
        var start = 1
        while (start <= total) {
            val end = (start + AnimeUnityClient.EPISODE_CHUNK - 1).coerceAtMost(total)
            windows.add(start..end)
            start = end + 1
        }
        return windows
    }

    /** Progresso per un episodio (numero assoluto), null se non guardato. */
    fun progressFor(episodeNumber: Int): ProgressEntry? = _progressByEpisode.value[episodeNumber]
}