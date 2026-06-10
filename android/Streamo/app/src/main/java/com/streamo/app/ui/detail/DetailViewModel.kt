package com.streamo.app.ui.detail

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.Data
import androidx.work.OneTimeWorkRequestBuilder
import android.app.Application
import androidx.work.WorkManager
import com.streamo.app.data.local.entity.DownloadEntry
import com.streamo.app.data.local.entity.HistoryEntry
import com.streamo.app.data.local.entity.ProgressEntry
import com.streamo.app.data.local.entity.WatchlistEntry
import com.streamo.app.data.remote.dto.TmdbEpisodeDetail
import com.streamo.app.data.remote.dto.TmdbItem
import com.streamo.app.data.remote.dto.TmdbReview
import androidx.media3.common.util.UnstableApi
import com.streamo.app.data.repository.AppRepository
import com.streamo.app.download.DownloadQualityGate
import com.streamo.app.download.DownloadQualityPref
import com.streamo.app.download.DownloadQualityRequest
import com.streamo.app.download.ResolveAndDownloadWorker
import com.streamo.app.provider.ProviderCandidate
import com.streamo.app.provider.ProviderMatchStatus
import com.streamo.app.provider.ProviderResolvedTitle
import com.streamo.app.provider.ProviderResolveFailureReason
import com.streamo.app.provider.ProviderResolveTitleOutcome
import com.streamo.app.provider.ProviderResolver
import com.streamo.app.tmdb.TMDBClient
import com.streamo.app.util.Release
import com.streamo.app.util.TVLogic
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import com.streamo.app.data.preferences.SettingsDataStore
import javax.inject.Inject

enum class ProviderAvailability {
    UNKNOWN, RESOLVING, READY, UNAVAILABLE, NEEDS_PICKER
}

@UnstableApi
@HiltViewModel
class DetailViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val client: TMDBClient,
    private val repository: AppRepository,
    private val providerResolver: ProviderResolver,
    private val qualityGate: DownloadQualityGate,
    private val settings: SettingsDataStore,
    private val app: Application
) : ViewModel() {

    val tmdbId: Int = checkNotNull(savedStateHandle["tmdbId"])
    val mediaType: String = checkNotNull(savedStateHandle["mediaType"])
    private val resumeSeason: Int = savedStateHandle["resumeSeason"] ?: 0
    private val resumeEpisode: Int = savedStateHandle["resumeEpisode"] ?: 0

    var item by mutableStateOf<TmdbItem?>(null)
        private set
    var recommendations by mutableStateOf(emptyList<TmdbItem>())
        private set
    var reviews by mutableStateOf(emptyList<TmdbReview>())
        private set
    var isLoading by mutableStateOf(true)
        private set
    var extrasLoading by mutableStateOf(false)
        private set
    var loadError by mutableStateOf<String?>(null)
        private set

    var seasons by mutableStateOf(emptyList<Int>())
        private set
    var selectedSeason by mutableStateOf(1)
        private set
    var episodes by mutableStateOf(emptyList<TmdbEpisodeDetail>())
        private set
    var loadingEpisodes by mutableStateOf(false)
        private set
    var episodeProgresses by mutableStateOf<Map<Pair<Int, Int>, ProgressEntry>>(emptyMap())
        private set

    var providerAvailability by mutableStateOf(ProviderAvailability.UNKNOWN)
        private set
    var providerMessage by mutableStateOf<String?>(null)
        private set
    var providerCandidates by mutableStateOf(emptyList<ProviderCandidate>())
        private set
    var showProviderPicker by mutableStateOf(false)

    var resumeSeasonEpisode by mutableStateOf<Pair<Int, Int>?>(null)
        private set
    var nextAfterResumeEpisode by mutableStateOf<Pair<Int, Int>?>(null)
        private set
    var movieResumeEntry by mutableStateOf<ProgressEntry?>(null)
        private set

    private val _isInWatchlist = MutableStateFlow(false)
    val isInWatchlist: StateFlow<Boolean> = _isInWatchlist.asStateFlow()

    val isTV: Boolean get() = mediaType == "tv"
    val isUpcoming: Boolean get() = item?.let { Release.isUpcoming(it, mediaType) } ?: false
    val releaseStatusText: String get() = item?.let { Release.fullStatus(it, mediaType) } ?: ""

    fun load() {
        viewModelScope.launch {
            isLoading = true
            loadError = null
            try {
                val loaded = client.details(tmdbId, mediaType)
                item = loaded
                if (isTV) {
                    seasons = TVLogic.availableSeasons(loaded)
                    val preferred = if (resumeSeason > 0) resumeSeason else null
                    val target = preferred?.takeIf { seasons.contains(it) } ?: seasons.firstOrNull() ?: 1
                    selectedSeason = target
                    loadSeason(target)
                }

                // Prime the provider resolver with any persisted mapping
                providerResolver.loadAndPrime(tmdbId, mediaType)
                resolveProvider()
                computeResume()
            } catch (e: Exception) {
                loadError = e.localizedMessage ?: "Errore di caricamento."
            }
            isLoading = false

            extrasLoading = true
            val recsDeferred = async { try { client.recommendations(tmdbId, mediaType) } catch (_: Exception) { emptyList() } }
            val revsDeferred = async { try { client.reviews(tmdbId, mediaType) } catch (_: Exception) { emptyList() } }
            recommendations = recsDeferred.await().take(20)
            reviews = revsDeferred.await().take(10)
            extrasLoading = false

            _isInWatchlist.value = repository.isInWatchlist(tmdbId)
        }
    }

    fun toggleWatchlist() {
        viewModelScope.launch {
            val current = item ?: return@launch
            if (_isInWatchlist.value) {
                repository.removeFromWatchlist(tmdbId)
                _isInWatchlist.value = false
            } else {
                repository.addToWatchlist(
                    WatchlistEntry(
                        tmdbId = tmdbId,
                        mediaType = mediaType,
                        title = current.title ?: current.name ?: "",
                        posterPath = current.posterPath
                    )
                )
                _isInWatchlist.value = true
            }
        }
    }

    /**
     * Segna il titolo come visto senza riprodurlo (port di markWatched iOS):
     * salva un marker di progresso completato (position == duration) che conta
     * come visto ma non mostra barre né appare in "Continua a guardare".
     * Per le serie azzera prima il progresso e marca l'ultimo episodio uscito.
     */
    fun markWatched() {
        viewModelScope.launch {
            val current = item ?: return@launch
            val title = current.title ?: current.name ?: ""
            var markedSeason = 0
            var markedEpisode = 0

            if (isTV) {
                val last = TVLogic.effectiveLastEpisode(current) ?: return@launch
                markedSeason = last.first
                markedEpisode = last.second
                repository.deleteProgress(tmdbId)
            }
            repository.saveProgress(
                ProgressEntry(
                    tmdbId = tmdbId,
                    mediaType = mediaType,
                    season = markedSeason,
                    episode = markedEpisode,
                    positionSeconds = 1.0,
                    durationSeconds = 1.0,
                    title = title,
                    posterPath = current.posterPath
                )
            )
            repository.addToHistory(
                HistoryEntry(
                    tmdbId = tmdbId,
                    mediaType = mediaType,
                    title = title,
                    posterPath = current.posterPath,
                    season = markedSeason,
                    episode = markedEpisode
                )
            )
            computeResume()
            infoMessage = "Segnato come visto"
        }
    }

    /**
     * Annulla il "visto" (port di markUnwatched iOS): rimuove tutto il
     * progresso del titolo, così torna "da vedere".
     */
    fun markUnwatched() {
        viewModelScope.launch {
            repository.deleteProgress(tmdbId)
            computeResume()
            infoMessage = "Segnato come da vedere"
        }
    }

    /** True se il titolo risulta interamente visto (marker o riproduzione). */
    var isWatched by mutableStateOf(false)
        private set

    /** Messaggio one-shot mostrato come toast dalla UI; azzerare dopo l'uso. */
    var infoMessage by mutableStateOf<String?>(null)

    fun consumeInfoMessage() {
        infoMessage = null
    }

    // Modale di scelta qualità (preferenza "Chiedi"). null = nessuna modale aperta.
    var qualityRequest by mutableStateOf<DownloadQualityRequest?>(null)
        private set
    var qualityResolving by mutableStateOf(false)
        private set
    private var pendingTarget: Pair<Int, Int>? = null

    fun enqueueDownload(season: Int = selectedSeason, episode: Int = 0) {
        viewModelScope.launch {
            val current = item ?: return@launch
            val net = qualityGate.currentNetwork()
            val pref = qualityGate.preferenceFor(net)
            if (pref !is DownloadQualityPref.Ask) {
                doEnqueue(current.title ?: current.name ?: "", season, episode, pref)
                return@launch
            }
            // "Chiedi": rileva le risoluzioni reali, poi mostra la modale.
            pendingTarget = season to episode
            qualityResolving = true
            val heights = qualityGate.availableHeights(
                tmdbId, mediaType, current.title ?: current.name ?: "", season, episode
            )
            qualityResolving = false
            qualityRequest = DownloadQualityRequest(net, heights, appliesToAll = false)
        }
    }

    fun confirmQuality(pref: DownloadQualityPref, savePreference: Boolean) {
        val req = qualityRequest ?: return
        val target = pendingTarget
        qualityRequest = null
        pendingTarget = null
        viewModelScope.launch {
            if (savePreference) qualityGate.savePreference(req.networkType, pref)
            val current = item ?: return@launch
            val (season, episode) = target ?: return@launch
            doEnqueue(current.title ?: current.name ?: "", season, episode, pref)
        }
    }

    fun dismissQuality() {
        qualityRequest = null
        pendingTarget = null
    }

    private suspend fun doEnqueue(
        title: String,
        season: Int,
        episode: Int,
        quality: DownloadQualityPref
    ) {
        val stillPath = if (isTV && episode > 0) {
            episodes.firstOrNull { it.episodeNumber == episode }?.stillPath
        } else null
        val entry = DownloadEntry(
            tmdbId = tmdbId,
            mediaType = mediaType,
            title = title,
            season = season.takeIf { isTV } ?: 0,
            episode = episode,
            posterPath = item?.posterPath,
            stillPath = stillPath,
            contentId = "${tmdbId}_${mediaType}_${season}_${episode}",
            localPath = "",
            quality = quality.entryQualityLabel(),
            status = "pending",
            warpEnabled = settings.warpEnabled.first()
        )
        val id = repository.addDownload(entry)
        ResolveAndDownloadWorker.enqueue(app, id.toInt())
    }

    fun changeSeason(season: Int) {
        if (!seasons.contains(season)) return
        selectedSeason = season
        viewModelScope.launch {
            loadSeason(season)
        }
    }

    private suspend fun loadSeason(season: Int) {
        loadingEpisodes = true
        val details = try {
            client.seasonDetails(tmdbId, season)
        } catch (_: Exception) {
            null
        }
        val aired = TVLogic.airedEpisodeList(details?.episodes.orEmpty(), item ?: return, season)
        episodes = if (aired.isEmpty()) {
            val count = item?.seasons?.find { it.seasonNumber == season }?.episodeCount ?: 10
            (1..maxOf(1, count)).map { TmdbEpisodeDetail.stub(it) }
        } else {
            aired
        }
        episodeProgresses = try {
            repository.getProgressForSeason(tmdbId, mediaType, season)
                .associateBy { Pair(it.season, it.episode) }
        } catch (_: Exception) {
            emptyMap()
        }
        loadingEpisodes = false
    }

    // region Provider resolution

    suspend fun resolveProvider() {
        providerAvailability = ProviderAvailability.RESOLVING
        providerMessage = null
        providerCandidates = emptyList()
        try {
            val outcome = providerResolver.resolveTitle(
                tmdbId,
                mediaType,
                item?.title ?: item?.name ?: "",
                item?.releaseDate
            )
            providerCandidates = outcome.candidates
            providerAvailability = when {
                outcome.resolved != null -> ProviderAvailability.READY
                outcome.candidates.isNotEmpty() -> ProviderAvailability.NEEDS_PICKER
                else -> ProviderAvailability.UNAVAILABLE
            }
            if (providerAvailability == ProviderAvailability.UNAVAILABLE) {
                providerMessage = when (outcome.reason) {
                    ProviderResolveFailureReason.NOT_FOUND -> "Titolo non disponibile"
                    ProviderResolveFailureReason.TEMPORARILY_UNAVAILABLE -> "Riproduzione temporaneamente non disponibile"
                    ProviderResolveFailureReason.UNRELEASED -> "Non ancora disponibile"
                    else -> outcome.reason?.name ?: "Titolo non disponibile"
                }
            }
        } catch (e: Exception) {
            providerAvailability = ProviderAvailability.UNAVAILABLE
            providerMessage = e.localizedMessage ?: "Errore di caricamento"
        }
    }

    fun confirmProviderCandidate(candidate: ProviderCandidate) {
        viewModelScope.launch {
            providerResolver.confirmCandidate(candidate, tmdbId, mediaType)
            val resolved = ProviderResolvedTitle(
                id = candidate.providerTitleId,
                slug = candidate.providerSlug,
                title = candidate.title,
                mediaType = mediaType
            )
            providerResolver.saveMapping(
                tmdbId,
                mediaType,
                ProviderResolveTitleOutcome(
                    resolved = resolved,
                    reason = null,
                    candidates = providerCandidates,
                    matchStatus = ProviderMatchStatus.MANUAL_CONFIRMED
                )
            )
            providerAvailability = ProviderAvailability.READY
            showProviderPicker = false
        }
    }

    fun refreshProvider() {
        viewModelScope.launch {
            providerResolver.invalidate(tmdbId, mediaType)
            resolveProvider()
        }
    }

    // endregion

    // region Smart resume

    private suspend fun computeResume() {
        if (isTV) {
            val next = nextUnwatched()
            resumeSeasonEpisode = next
            nextAfterResumeEpisode = next?.let {
                TVLogic.nextEpisode(item ?: return, it.first, it.second)
            }
        } else {
            movieResumeEntry = movieResume()
        }
        isWatched = computeWatched()
    }

    /** Interamente visto = ultimo progresso completato e nessun episodio successivo. */
    private suspend fun computeWatched(): Boolean {
        val p = repository.getLatestProgressForTitle(tmdbId, mediaType) ?: return false
        val ended = p.durationSeconds > 0 && p.positionSeconds >= p.durationSeconds * TVLogic.WATCHED_THRESHOLD
        if (!ended) return false
        if (!isTV) return true
        val current = item ?: return true
        return TVLogic.nextEpisode(current, p.season, p.episode) == null
    }

    private suspend fun nextUnwatched(): Pair<Int, Int>? {
        if (mediaType != "tv") return null
        val progress = repository.getProgress(tmdbId) ?: return null
        if (progress.mediaType != "tv") return null
        val ended = progress.durationSeconds > 0 && progress.positionSeconds >= progress.durationSeconds * TVLogic.WATCHED_THRESHOLD
        if (!ended) return Pair(progress.season, progress.episode)
        // Ended: go to next episode. If no next episode (all watched), return null.
        return TVLogic.nextEpisode(item ?: return null, progress.season, progress.episode)
    }

    private suspend fun movieResume(): ProgressEntry? {
        if (mediaType != "movie") return null
        val p = repository.getProgress(tmdbId) ?: return null
        if (p.positionSeconds <= 10) return null
        if (p.durationSeconds > 0 && p.positionSeconds >= p.durationSeconds * TVLogic.WATCHED_THRESHOLD) return null
        return p
    }

    // endregion

    val metaLine: String
        get() {
            val it = item ?: return ""
            val parts = mutableListOf<String>()
            it.year?.let { parts.add(it.toString()) }
            runtimeText?.let { parts.add(it) }
            it.voteAverage?.takeIf { it > 0 }?.let { parts.add(String.format("★ %.1f", it)) }
            return parts.joinToString(" · ")
        }

    val genresLine: String
        get() = item?.genres?.map { it.name }?.joinToString(", ") ?: ""

    val castLine: String
        get() = item?.credits?.cast?.take(6)?.map { it.name }?.joinToString(", ") ?: ""

    val tvSummary: String
        get() {
            if (!isTV) return ""
            val it = item ?: return ""
            val seasons = it.numberOfSeasons ?: 0
            val episodes = it.numberOfEpisodes ?: 0
            if (seasons <= 0) return ""
            val ses = if (seasons == 1) "stagione" else "stagioni"
            val eps = if (episodes == 1) "episodio" else "episodi"
            if (episodes <= 0) return "$seasons $ses"
            val aired = TVLogic.airedEpisodesCount(it)
            return if (aired > 0 && aired < episodes) {
                "$seasons $ses · $aired/$episodes $eps usciti"
            } else {
                "$seasons $ses · $episodes $eps"
            }
        }

    val playLabel: String
        get() {
            if (isUpcoming) return "Non ancora disponibile"
            return when (providerAvailability) {
                ProviderAvailability.RESOLVING -> "Caricamento…"
                ProviderAvailability.UNAVAILABLE -> providerMessage ?: "Non disponibile"
                ProviderAvailability.NEEDS_PICKER -> "Scegli la versione"
                ProviderAvailability.READY -> {
                    if (isTV) {
                        resumeSeasonEpisode?.let { "Riprendi da S${it.first} E${it.second}" } ?: "Guarda"
                    } else {
                        movieResumeEntry?.let { "Riprendi da ${formatTime(it.positionSeconds)}" } ?: "Guarda"
                    }
                }
                else -> "Riproduci"
            }
        }

    private fun formatTime(seconds: Double): String {
        val total = seconds.toInt()
        val h = total / 3600
        val m = (total % 3600) / 60
        val s = total % 60
        return if (h > 0) String.format("%d:%02d:%02d", h, m, s) else String.format("%02d:%02d", m, s)
    }

    val trailerUrl: String?
        get() {
            val videos = item?.videos?.results.orEmpty().filter { it.site == "YouTube" && it.key != null }
            if (videos.isEmpty()) return null
            val best = videos.firstOrNull { it.type == "Trailer" && it.official == true }
                ?: videos.firstOrNull { it.type == "Trailer" }
                ?: videos.firstOrNull()
            return best?.key?.let { "https://www.youtube.com/watch?v=$it" }
        }

    val rankBadge: String?
        get() {
            val p = item?.popularity ?: return null
            if (p <= 0) return null
            return String.format("%,d", p.toInt())
        }

    private val runtimeText: String?
        get() {
            val it = item ?: return null
            if (isTV) {
                val m = it.episodeRunTime?.firstOrNull() ?: return null
                if (m <= 0) return null
                return "$m min/episodio"
            }
            val m = it.runtime ?: return null
            if (m <= 0) return null
            val h = m / 60
            val mm = m % 60
            return when {
                h > 0 && mm > 0 -> "${h}h ${mm}min"
                h > 0 -> "${h}h"
                else -> "${mm}min"
            }
        }
}