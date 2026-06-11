package com.streamo.app.ui.tv

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.streamo.app.data.local.entity.ProgressEntry
import com.streamo.app.data.repository.AppRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * ViewModel a livello di root TV: serve solo al consumer globale dei comandi Obsidian
 * cast per persistere la posizione di partenza prima di aprire il player.
 */
@HiltViewModel
class TvCastViewModel @Inject constructor(
    private val repository: AppRepository
) : ViewModel() {

    /**
     * Salva un progress entry così il player TV, una volta aperto dal comando di cast,
     * riprende automaticamente dalla posizione voluta. durationSeconds è un valore alto
     * fittizio così il check di resume (>10s, <90%) passa.
     *
     * Preserva titolo/poster/durata reali se già presenti: [ProgressEntry] usa REPLACE su
     * chiave composta, quindi scrivere title="" sovrascriverebbe la card Continue Watching.
     */
    fun saveExternalStartPosition(
        tmdbId: Int,
        mediaType: String,
        season: Int,
        episode: Int,
        positionMs: Long,
        title: String = "",
        posterPath: String? = null
    ) {
        viewModelScope.launch {
            val posSec = positionMs / 1000.0
            val existing = repository.getProgressByCoordinate(tmdbId, mediaType, season, episode)
            val dur = existing?.durationSeconds?.takeIf { it > posSec } ?: (posSec + 3600.0)
            repository.saveProgress(
                ProgressEntry(
                    tmdbId = tmdbId,
                    mediaType = mediaType,
                    season = season,
                    episode = episode,
                    positionSeconds = posSec,
                    durationSeconds = dur,
                    title = title.ifBlank { existing?.title ?: "" },
                    posterPath = posterPath ?: existing?.posterPath
                )
            )
        }
    }
}
