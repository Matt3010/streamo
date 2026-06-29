package com.streamo.app.ui.anime

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.streamo.app.data.local.entity.ProgressEntry
import com.streamo.app.data.repository.AppRepository
import com.streamo.app.provider.anime.AnimeUnityClient
import com.streamo.app.provider.anime.AUAnime
import com.streamo.app.util.TVLogic
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Catalogo AnimeUnity (browse paginato + ricerca live) per il tab Anime.
 * Port of iOS `AnimeCatalogModel`. A differenza di Home, l'anime è un catalogo
 * nativo (id propri, niente TMDB): paginazione via `offset` (30/pagina).
 */
@HiltViewModel
class AnimeViewModel @Inject constructor(
    private val animeClient: AnimeUnityClient,
    private val repository: AppRepository
) : ViewModel() {

    var catalog by mutableStateOf<List<AUAnime>>(emptyList())
        private set

    var isLoading by mutableStateOf(false)
        private set

    var errorMessage by mutableStateOf<String?>(null)
        private set

    var query by mutableStateOf("")
        private set

    /** True quando il browse ha restituito una pagina vuota (offset esaurito). */
    private var endReached = false
    private var offset = 0
    private var loadingMore = false
    private var searchJob: Job? = null

    private val _continueRows = MutableStateFlow<List<ProgressEntry>>(emptyList())
    val continueRows: StateFlow<List<ProgressEntry>> = _continueRows.asStateFlow()

    init {
        viewModelScope.launch {
            repository.progress().collect { list ->
                _continueRows.value = list
                    .filter { it.mediaType == "anime" }
                    .groupBy { it.tmdbId } // un anime = un id AnimeUnity
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

    private var hasLoaded = false

    fun reload() {
        viewModelScope.launch {
            isLoading = true
            errorMessage = null
            offset = 0
            endReached = false
            try {
                val items = animeClient.browse(offset = 0)
                catalog = items
                endReached = items.isEmpty()
            } catch (e: Exception) {
                errorMessage = "Impossibile caricare il catalogo. Controlla la connessione."
            }
            isLoading = false
        }
    }

    /** Pagina successiva del browse (chiamata quando la griglia si avvicina al fondo). */
    fun loadMore() {
        if (loadingMore || endReached || query.isNotBlank()) return
        loadingMore = true
        viewModelScope.launch {
            try {
                val nextOffset = offset + PAGE_SIZE
                val items = animeClient.browse(offset = nextOffset)
                if (items.isNotEmpty()) {
                    catalog = catalog + items
                    offset = nextOffset
                } else {
                    endReached = true
                }
            } catch (_: Exception) {
                // Silenzioso: la pagina corrente resta, si riprova al prossimo scroll.
            }
            loadingMore = false
        }
    }

    fun onQueryChange(value: String) {
        query = value
        searchJob?.cancel()
        if (value.isBlank()) {
            // Query svuotata: ripristina sempre il browse (il catalogo ora tiene
            // i risultati di ricerca con endReached=true → senza reload resterebbe
            // bloccato sui vecchi risultati e la paginazione non ripartirebbe).
            if (hasLoaded) reload()
            return
        }
        searchJob = viewModelScope.launch {
            kotlinx.coroutines.delay(SEARCH_DEBOUNCE_MS)
            isLoading = true
            errorMessage = null
            try {
                val results = animeClient.search(value)
                catalog = results
                endReached = true // la ricerca non pagina
            } catch (e: Exception) {
                errorMessage = "Ricerca non disponibile. Riprova."
            }
            isLoading = false
        }
    }

    /** Riprende un anime dal "Continua a guardare": salta alla pagina dettaglio. */
    fun continueEntry(entry: ProgressEntry): AnimeResumeTarget? {
        // episodeId 0 = id mancante (vecchio salvataggio o dato corrotto): non è
        // risolvibile in embed → torna null così la card apre il dettaglio.
        val episodeId = entry.providerEpisodeId?.takeIf { it > 0 } ?: return null
        return AnimeResumeTarget(
            animeId = entry.tmdbId,
            slug = entry.providerSlug,
            title = entry.title,
            poster = entry.posterPath,
            episodeId = episodeId,
            episode = entry.episode
        )
    }

    companion object {
        private const val PAGE_SIZE = 30
        private const val SEARCH_DEBOUNCE_MS = 350L
    }
}

/** Dati per riprendere un anime: episodeId AnimeUnity + coordinate per il Player. */
data class AnimeResumeTarget(
    val animeId: Int,
    val slug: String?,
    val title: String?,
    val poster: String?,
    val episodeId: Int,
    val episode: Int
)