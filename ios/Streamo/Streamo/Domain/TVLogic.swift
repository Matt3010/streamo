import Foundation

/// TV/episode counting + next-episode logic. Port of the web
/// `next-episode.ts`, `aired-episodes.util.ts` and `release-format.ts`
/// counting helpers, operating on a `TmdbItem` (which already carries
/// `seasons`, `lastEpisodeToAir`, `nextEpisodeToAir`).
enum TVLogic {
    /// Single playback threshold: an episode/movie at ≥90% counts as watched,
    /// drops out of "continua a guardare", and pivots the CTA to the next one.
    static let watchedThreshold = 0.9

    /// Where to resume a coordinate from, independent of `watchedThreshold`:
    /// keep offering the saved position right up until the title is *actually*
    /// finished. The end observer writes `position == duration` only on a real
    /// play-to-end, so closing at 95% still resumes, while a 100% title restarts
    /// from the beginning. Returns the seconds to seed, or nil to start at 0.
    /// `position` must clear the 15s "actually started" gate.
    static func resumeStart(position: Double, duration: Double) -> Double? {
        guard position > 15 else { return nil }
        if duration > 0, position >= duration { return nil }
        return position
    }

    /// Single source of truth for "counts as watched": a valid duration with
    /// progress at or past `watchedThreshold`. The `duration > 0` guard is part
    /// of the contract — never inline this check, it has been a source of
    /// divergent bugs (a missing guard treats 0/0 as watched).
    static func isWatched(position: Double, duration: Double) -> Bool {
        duration > 0 && position >= duration * watchedThreshold
    }

    /// True when a YYYY-MM-DD string is strictly after today (local).
    /// Shares the single date parser/comparator in `Release`.
    static func isFutureDate(_ dateStr: String?) -> Bool {
        guard let date = Release.parseDate(dateStr) else { return false }
        return Release.isFuture(date)
    }

    // MARK: - Episode counting

    /// Cumulative aired/episode count up to (and including) `ref`. Skips season 0.
    static func countEpisodesUpTo(_ item: TmdbItem, season: Int?, episode: Int?) -> Int {
        guard let season, let episode else { return item.numberOfEpisodes ?? 0 }
        var count = 0
        for s in item.seasons ?? [] where s.seasonNumber != 0 {
            if s.seasonNumber < season {
                count += s.episodeCount ?? 0
            } else if s.seasonNumber == season {
                count += episode
            }
        }
        return count
    }

    /// Latest episode treated as aired (next_episode_to_air if its air_date has
    /// passed, else last_episode_to_air).
    static func effectiveLastEpisode(_ item: TmdbItem) -> (season: Int, episode: Int)? {
        if let nea = item.nextEpisodeToAir, let s = nea.seasonNumber, let e = nea.episodeNumber,
           let ad = nea.airDate, !isFutureDate(ad) {
            return (s, e)
        }
        if let lea = item.lastEpisodeToAir, let s = lea.seasonNumber, let e = lea.episodeNumber {
            return (s, e)
        }
        return nil
    }

    /// Total aired episodes across the show.
    static func airedEpisodesCount(_ item: TmdbItem) -> Int {
        let lea = effectiveLastEpisode(item)
        return countEpisodesUpTo(item, season: lea?.season, episode: lea?.episode)
    }

    /// Aired episodes within a single season.
    static func airedEpisodesInSeason(_ item: TmdbItem, season: Int) -> Int {
        guard let info = (item.seasons ?? []).first(where: { $0.seasonNumber == season }) else { return 0 }
        let total = info.episodeCount ?? 0
        guard let lea = effectiveLastEpisode(item) else { return total }
        if season < lea.season { return total }
        if season > lea.season { return 0 }
        return min(total, lea.episode)
    }

    /// Episode count BEFORE (season, episode) — treats earlier episodes as watched.
    static func episodesBefore(_ item: TmdbItem, season: Int, episode: Int) -> Int {
        guard season > 0 else { return 0 }
        return countEpisodesUpTo(item, season: season, episode: max(0, episode - 1))
    }

    // MARK: - Navigation

    /// Seasons selectable in the UI (season_number > 0, capped at the last
    /// aired season). Port of the web `availableSeasons`.
    static func availableSeasons(_ item: TmdbItem) -> [Int] {
        let seasons = (item.seasons ?? []).filter { $0.seasonNumber > 0 }
        let nums: [Int]
        if let lastAired = effectiveLastEpisode(item)?.season {
            nums = seasons.filter { $0.seasonNumber <= lastAired }.map(\.seasonNumber)
        } else {
            // No effective-last boundary: keep only seasons with a known,
            // already-aired air_date (web excludes nil to avoid leaking
            // unannounced future seasons into the picker).
            nums = seasons.filter { $0.airDate != nil && !isFutureDate($0.airDate) }.map(\.seasonNumber)
        }
        let sorted = nums.sorted()
        return sorted.isEmpty ? [1] : sorted
    }

    /// The episode immediately after (season, episode), or nil if none aired.
    /// Port of `findNextEpisode`.
    static func nextEpisode(_ item: TmdbItem, season: Int, episode: Int) -> (season: Int, episode: Int)? {
        let currentAired = airedEpisodesInSeason(item, season: season)
        if currentAired > 0, episode + 1 <= currentAired {
            return (season, episode + 1)
        }
        let future = (item.seasons ?? [])
            .filter { $0.seasonNumber > season && airedEpisodesInSeason(item, season: $0.seasonNumber) > 0 }
            .sorted { $0.seasonNumber < $1.seasonNumber }
            .first
        return future.map { ($0.seasonNumber, 1) }
    }

    /// Aired episode numbers for a season given the show-level boundary,
    /// preferring the effective-last-episode cap over per-episode air dates.
    /// Port of the web `airedEpisodes` filter.
    static func airedEpisodeList(_ episodes: [TmdbEpisodeDetail], item: TmdbItem, season: Int) -> [TmdbEpisodeDetail] {
        let sorted = episodes.sorted { $0.episodeNumber < $1.episodeNumber }
        if let lea = effectiveLastEpisode(item) {
            if season < lea.season { return sorted }
            if season > lea.season { return [] }
            return sorted.filter { $0.episodeNumber <= lea.episode }
        }
        // Fallback: per-episode air_date with end-of-day cutoff.
        return sorted.filter { !isFutureDate($0.airDate) && $0.airDate != nil }
    }
}
