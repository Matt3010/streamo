package com.streamo.app.util

import com.streamo.app.data.remote.dto.TmdbEpisodeDetail
import com.streamo.app.data.remote.dto.TmdbItem
import java.util.Calendar

object TVLogic {
    const val WATCHED_THRESHOLD = 0.9

    fun isFutureDate(dateStr: String?): Boolean {
        val parts = ymd(dateStr) ?: return false
        val cal = Calendar.getInstance()
        val today = cal.apply { set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }.time
        val date = cal.apply { set(parts.first, parts.second - 1, parts.third, 0, 0, 0); set(Calendar.MILLISECOND, 0) }.time
        return date > today
    }

    private fun ymd(s: String?): Triple<Int, Int, Int>? {
        if (s.isNullOrEmpty() || s.length < 10) return null
        val parts = s.substring(0, 10).split("-")
        if (parts.size != 3) return null
        val y = parts[0].toIntOrNull() ?: return null
        val m = parts[1].toIntOrNull() ?: return null
        val d = parts[2].toIntOrNull() ?: return null
        return Triple(y, m, d)
    }

    fun countEpisodesUpTo(item: TmdbItem, season: Int?, episode: Int?): Int {
        if (season == null || episode == null) return item.numberOfEpisodes ?: 0
        var count = 0
        for (s in item.seasons.orEmpty().filter { it.seasonNumber != 0 }) {
            when {
                s.seasonNumber < season -> count += s.episodeCount ?: 0
                s.seasonNumber == season -> count += episode
            }
        }
        return count
    }

    fun effectiveLastEpisode(item: TmdbItem): Pair<Int, Int>? {
        val nea = item.nextEpisodeToAir
        if (nea?.seasonNumber != null && nea.episodeNumber != null && nea.airDate != null && !isFutureDate(nea.airDate)) {
            return Pair(nea.seasonNumber, nea.episodeNumber)
        }
        val lea = item.lastEpisodeToAir
        if (lea?.seasonNumber != null && lea.episodeNumber != null) {
            return Pair(lea.seasonNumber, lea.episodeNumber)
        }
        return null
    }

    fun airedEpisodesCount(item: TmdbItem): Int {
        val lea = effectiveLastEpisode(item) ?: return 0
        return countEpisodesUpTo(item, lea.first, lea.second)
    }

    fun airedEpisodesInSeason(item: TmdbItem, season: Int): Int {
        val info = item.seasons?.find { it.seasonNumber == season } ?: return 0
        val total = info.episodeCount ?: 0
        val lea = effectiveLastEpisode(item) ?: return total
        return when {
            season < lea.first -> total
            season > lea.first -> 0
            else -> minOf(total, lea.second)
        }
    }

    fun episodesBefore(item: TmdbItem, season: Int, episode: Int): Int {
        if (season <= 0) return 0
        return countEpisodesUpTo(item, season, maxOf(0, episode - 1))
    }

    fun availableSeasons(item: TmdbItem): List<Int> {
        val seasons = item.seasons.orEmpty().filter { it.seasonNumber > 0 }
        val nums: List<Int> = if (effectiveLastEpisode(item) != null) {
            val lastAired = effectiveLastEpisode(item)!!.first
            seasons.filter { it.seasonNumber <= lastAired }.map { it.seasonNumber }
        } else {
            seasons.filter { it.airDate != null && !isFutureDate(it.airDate) }.map { it.seasonNumber }
        }
        return nums.sorted().ifEmpty { listOf(1) }
    }

    fun nextEpisode(item: TmdbItem, season: Int, episode: Int): Pair<Int, Int>? {
        val currentAired = airedEpisodesInSeason(item, season)
        if (currentAired > 0 && episode + 1 <= currentAired) {
            return Pair(season, episode + 1)
        }
        val future = item.seasons.orEmpty()
            .filter { it.seasonNumber > season && airedEpisodesInSeason(item, it.seasonNumber) > 0 }
            .sortedBy { it.seasonNumber }
            .firstOrNull()
        return future?.let { Pair(it.seasonNumber, 1) }
    }

    /**
     * Mirror of [nextEpisode]: the previous episode's (season, episode) coordinate, or null
     * if [season]/[episode] is already the earliest aired episode (S1E1 in practice).
     */
    fun previousEpisode(item: TmdbItem, season: Int, episode: Int): Pair<Int, Int>? {
        if (episode > 1) {
            return Pair(season, episode - 1)
        }
        val past = item.seasons.orEmpty()
            .filter { it.seasonNumber < season && airedEpisodesInSeason(item, it.seasonNumber) > 0 }
            .sortedByDescending { it.seasonNumber }
            .firstOrNull()
        return past?.let { Pair(it.seasonNumber, airedEpisodesInSeason(item, it.seasonNumber)) }
    }

    fun airedEpisodeList(episodes: List<TmdbEpisodeDetail>, item: TmdbItem, season: Int): List<TmdbEpisodeDetail> {
        val sorted = episodes.sortedBy { it.episodeNumber }
        val lea = effectiveLastEpisode(item)
        return if (lea != null) {
            when {
                season < lea.first -> sorted
                season > lea.first -> emptyList()
                else -> sorted.filter { it.episodeNumber <= lea.second }
            }
        } else {
            sorted.filter { !isFutureDate(it.airDate) && it.airDate != null }
        }
    }
}
