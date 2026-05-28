import Foundation
import Observation

/// Loads TMDB details for every watchlist entry (memo-cached by TMDBClient) to
/// derive whether a title is still unreleased (for the "Non usciti" filter) and
/// to run the on-read status auto-flip. The per-card badge/status text is
/// computed by `MediaCard` itself, so it's not done here.
@MainActor
@Observable
final class WatchlistEnrichment {
    /// keys ("type-tmdbId") whose title hasn't released yet.
    private(set) var upcoming: Set<String> = []

    static func key(_ tmdbId: Int, _ type: MediaType) -> String { "\(type.rawValue)-\(tmdbId)" }

    func isUpcoming(_ e: WatchlistEntry) -> Bool { upcoming.contains(Self.key(e.tmdbId, e.mediaType)) }

    func refresh(_ entries: [WatchlistEntry], library: Library) async {
        for e in entries {
            guard let item = try? await TMDBClient.shared.details(id: e.tmdbId, type: e.mediaType) else { continue }
            let k = Self.key(e.tmdbId, e.mediaType)
            if Release.isUpcoming(item, e.mediaType) { upcoming.insert(k) } else { upcoming.remove(k) }

            guard e.mediaType == .tv else { continue }
            let watched = library.watchedEpisodeCount(e.tmdbId)
            let resume = library.nextUnwatched(item: item)
            let aired = TVLogic.airedEpisodesCount(item)
            let doneAired = e.doneAiredEpisodes ?? 0
            let implied = resume.map { TVLogic.episodesBefore(item, season: $0.season, episode: $0.episode) } ?? 0
            autoFlipStatus(e, aired: aired, baseline: max(watched, doneAired, implied), doneAired: doneAired, library: library)
        }
    }

    /// On-read auto-flip (no background worker on device) — port of the web
    /// watchlist read-path + maybeAutoCompleteWatchlist:
    /// - done with no baseline → back-fill the mark to the current aired count.
    /// - done → in_progress when new episodes aired beyond the mark.
    /// - todo/in_progress → done once caught up with every aired episode.
    private func autoFlipStatus(_ e: WatchlistEntry, aired: Int, baseline: Int, doneAired: Int, library: Library) {
        guard aired > 0 else { return }
        if e.status == .done {
            if doneAired == 0 {
                library.setWatchlistStatus(e.tmdbId, e.mediaType, .done, doneAiredEpisodes: aired)
            } else if aired > doneAired {
                library.setWatchlistStatus(e.tmdbId, e.mediaType, .inProgress)
            }
        } else if baseline >= aired {           // todo/in_progress and caught up
            library.setWatchlistStatus(e.tmdbId, e.mediaType, .done, doneAiredEpisodes: aired)
        }
    }
}
