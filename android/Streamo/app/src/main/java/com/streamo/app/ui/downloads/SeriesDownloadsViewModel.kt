package com.streamo.app.ui.downloads

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.streamo.app.data.local.entity.DownloadEntry
import com.streamo.app.data.remote.dto.TmdbEpisodeDetail
import androidx.media3.common.util.UnstableApi
import com.streamo.app.data.repository.StreamoRepository
import com.streamo.app.download.DownloadQualityGate
import com.streamo.app.download.DownloadQualityPref
import com.streamo.app.download.DownloadQualityRequest
import com.streamo.app.download.ResolveAndDownloadWorker
import com.streamo.app.tmdb.TMDBClient
import com.streamo.app.util.TVLogic
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

@UnstableApi
@HiltViewModel
class SeriesDownloadsViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val repository: StreamoRepository,
    private val client: TMDBClient,
    private val qualityGate: DownloadQualityGate,
    private val app: Application
) : ViewModel() {

    val tmdbId: Int = checkNotNull(savedStateHandle["tmdbId"])
    val title: String = checkNotNull(savedStateHandle["title"])
    val showAllEpisodes: Boolean = savedStateHandle["showAllEpisodes"] ?: false

    // Raw downloads from DB
    val dbEntries = repository.downloadsForTmdbId(tmdbId)

    // For "showAllEpisodes" mode: full episode list merged with download status
    var seasons by mutableStateOf(emptyList<Int>())
        private set
    var selectedSeason by mutableStateOf(1)
    var allEpisodes by mutableStateOf(emptyList<TmdbEpisodeDetail>())
        private set
    var loadingAllEpisodes by mutableStateOf(false)
        private set
    var loadError by mutableStateOf<String?>(null)
        private set

    // Episode details map (season, episode) -> TmdbEpisodeDetail for downloaded-only mode
    var episodeDetails by mutableStateOf<Map<Pair<Int, Int>, TmdbEpisodeDetail>>(emptyMap())
        private set

    // Download status map (contentId -> entry) for quick lookup
    private val _downloadMap = MutableStateFlow<Map<String, DownloadEntry>>(emptyMap())
    val downloadMap: StateFlow<Map<String, DownloadEntry>> = _downloadMap.asStateFlow()

    init {
        viewModelScope.launch {
            dbEntries.collect { list ->
                _downloadMap.value = list.associateBy { it.contentId }
            }
        }
    }

    fun load() {
        viewModelScope.launch {
            loadingAllEpisodes = true
            loadError = null
            try {
                val details = client.details(tmdbId, "tv")
                val available = TVLogic.availableSeasons(details)
                seasons = available

                // Load episode details for all seasons that have downloads
                val current = dbEntries.first()
                val neededSeasons = if (showAllEpisodes) available else {
                    current.map { it.season }.filter { it > 0 }.toSet().intersect(available.toSet())
                }
                val allDetails = mutableMapOf<Pair<Int, Int>, TmdbEpisodeDetail>()
                neededSeasons.forEach { season ->
                    val sd = try { client.seasonDetails(tmdbId, season) } catch (_: Exception) { null }
                    val aired = TVLogic.airedEpisodeList(sd?.episodes.orEmpty(), details, season)
                    aired.forEach { ep ->
                        allDetails[Pair(season, ep.episodeNumber)] = ep
                    }
                }
                episodeDetails = allDetails

                // Persist still paths back to DB so the global downloads list shows them too.
                current.forEach { entry ->
                    if (entry.mediaType == "tv" && entry.season > 0) {
                        val still = allDetails[Pair(entry.season, entry.episode)]?.stillPath
                        if (!still.isNullOrBlank() && entry.stillPath.isNullOrBlank()) {
                            repository.updateDownloadStillPath(entry.id, still)
                        }
                        if (entry.posterPath.isNullOrBlank() && !details.posterPath.isNullOrBlank()) {
                            repository.updateDownloadPosterPath(entry.id, details.posterPath)
                        }
                    }
                }

                if (showAllEpisodes) {
                    selectedSeason = available.firstOrNull() ?: 1
                    loadSeasonEpisodes(selectedSeason)
                }
            } catch (e: Exception) {
                loadError = e.localizedMessage ?: "Errore di caricamento."
            }
            loadingAllEpisodes = false
        }
    }

    fun changeSeason(season: Int) {
        if (!seasons.contains(season)) return
        selectedSeason = season
        if (showAllEpisodes) {
            viewModelScope.launch {
                loadSeasonEpisodes(season)
            }
        }
    }

    private suspend fun loadSeasonEpisodes(season: Int) {
        val details = try {
            client.seasonDetails(tmdbId, season)
        } catch (_: Exception) {
            null
        }
        val item = try { client.details(tmdbId, "tv") } catch (_: Exception) { null }
        val aired = TVLogic.airedEpisodeList(details?.episodes.orEmpty(), item ?: return, season)
        allEpisodes = if (aired.isEmpty()) {
            val count = item?.seasons?.find { it.seasonNumber == season }?.episodeCount ?: 10
            (1..maxOf(1, count)).map { TmdbEpisodeDetail.stub(it) }
        } else {
            aired
        }
    }

    // Modale di scelta qualità (preferenza "Chiedi").
    var qualityRequest by mutableStateOf<DownloadQualityRequest?>(null)
        private set
    var qualityResolving by mutableStateOf(false)
        private set
    private var pendingTargets: List<Pair<Int, Int>> = emptyList()

    private suspend fun addAndEnqueue(season: Int, episode: Int, quality: DownloadQualityPref) {
        val entry = DownloadEntry(
            tmdbId = tmdbId,
            mediaType = "tv",
            title = title,
            season = season,
            episode = episode,
            contentId = "${tmdbId}_tv_${season}_${episode}",
            localPath = "",
            quality = quality.entryQualityLabel(),
            status = "pending"
        )
        val id = repository.addDownload(entry)
        // Serial queue: one download at a time (see ResolveAndDownloadWorker.enqueue).
        ResolveAndDownloadWorker.enqueue(app, id.toInt())
    }

    /**
     * Scarica diretto se la preferenza di rete è impostata, altrimenti rileva le risoluzioni
     * e apre la modale. [appliesToAll] avvisa che la scelta vale per tutti i [targets].
     */
    private suspend fun requestOrEnqueue(targets: List<Pair<Int, Int>>, appliesToAll: Boolean) {
        if (targets.isEmpty()) return
        val net = qualityGate.currentNetwork()
        val pref = qualityGate.preferenceFor(net)
        if (pref !is DownloadQualityPref.Ask) {
            targets.forEach { addAndEnqueue(it.first, it.second, pref) }
            return
        }
        pendingTargets = targets
        qualityResolving = true
        val first = targets.first()
        val heights = qualityGate.availableHeights(tmdbId, "tv", title, first.first, first.second)
        qualityResolving = false
        qualityRequest = DownloadQualityRequest(net, heights, appliesToAll)
    }

    fun confirmQuality(pref: DownloadQualityPref, savePreference: Boolean) {
        val req = qualityRequest ?: return
        val targets = pendingTargets
        qualityRequest = null
        pendingTargets = emptyList()
        viewModelScope.launch {
            if (savePreference) qualityGate.savePreference(req.networkType, pref)
            targets.forEach { addAndEnqueue(it.first, it.second, pref) }
        }
    }

    fun dismissQuality() {
        qualityRequest = null
        pendingTargets = emptyList()
    }

    fun enqueueDownload(season: Int, episode: Int) {
        viewModelScope.launch { requestOrEnqueue(listOf(season to episode), appliesToAll = false) }
    }

    /** Enqueue every aired episode (all seasons) not already downloading/downloaded. */
    fun downloadAll() {
        viewModelScope.launch {
            val existing = repository.downloadsForTmdbId(tmdbId).first()
                .map { it.contentId }.toSet()
            val targets = episodeDetails.keys
                .sortedWith(compareBy({ it.first }, { it.second }))
                .filter { (season, episode) -> "${tmdbId}_tv_${season}_${episode}" !in existing }
            requestOrEnqueue(targets, appliesToAll = true)
        }
    }

    /** Remove all downloads (any state) for this series, cache included. */
    fun removeAll() {
        viewModelScope.launch {
            repository.downloadsForTmdbId(tmdbId).first().forEach { purge(it) }
        }
    }

    fun removeDownload(entry: DownloadEntry) {
        viewModelScope.launch { purge(entry) }
    }

    /** Stop work, delete cached data from disk, then drop the DB row. */
    private suspend fun purge(entry: DownloadEntry) {
        ResolveAndDownloadWorker.cancel(app, entry.id)
        withContext(Dispatchers.IO) {
            ResolveAndDownloadWorker.removeCachedData(entry.streamUrl)
        }
        repository.removeDownload(entry.id)
    }

    fun toggleEpisodeDownload(season: Int, episode: Int) {
        viewModelScope.launch {
            val contentId = "${tmdbId}_tv_${season}_${episode}"
            val existing = repository.getDownloadByContentId(contentId)
            if (existing != null) {
                purge(existing)
            } else {
                enqueueDownload(season, episode)
            }
        }
    }

    fun stop(entry: DownloadEntry) {
        viewModelScope.launch {
            ResolveAndDownloadWorker.cancel(app, entry.id)
            repository.updateDownloadStatusResetSpeed(entry.id, "paused")
        }
    }

    fun restart(entry: DownloadEntry) {
        viewModelScope.launch {
            repository.resetRetryCount(entry.id)
            repository.updateDownloadStatusResetSpeed(entry.id, "pending")
            ResolveAndDownloadWorker.enqueue(app, entry.id)
        }
    }
}
