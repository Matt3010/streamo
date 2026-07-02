import Foundation
import Observation

/// Loads fresh TMDB details for every watchlist entry to derive the per-card
/// display values (year, rating, release note) and whether a title is still
/// unreleased (so the card can dim upcoming titles).
@MainActor
@Observable
final class WatchlistEnrichment {
    /// keys ("type-tmdbId") whose title hasn't released yet.
    private(set) var upcoming: Set<String> = []
    /// True once the first full enrichment pass has completed — the view shows
    /// skeletons until then so the heavy pass happens up-front, not mid-scroll.
    private(set) var isLoaded = false
    /// Guards against overlapping passes: the auto-flip writes bump
    /// `library.version`, which must NOT restart enrichment — that re-fire was
    /// the churn that made the list lag.
    private var isRefreshing = false

    /// Per-card display values derived once during enrichment, so the grid's
    /// `MediaCard`s don't recompute them (TMDB detail + SwiftData status
    /// queries) while scrolling.
    struct Extras {
        var year: String?
        var rating: String?
        var releaseText: String?
        var isUpcoming: Bool
    }
    private(set) var extrasByKey: [String: Extras] = [:]

    static func key(_ tmdbId: Int, _ type: MediaType) -> String { "\(type.rawValue)-\(tmdbId)" }

    func isUpcoming(_ e: WatchlistEntry) -> Bool { upcoming.contains(Self.key(e.tmdbId, e.mediaType)) }

    func extras(for e: WatchlistEntry) -> Extras? { extrasByKey[Self.key(e.tmdbId, e.mediaType)] }

    /// Sendable copy of the fields enrichment needs, so entries (SwiftData
    /// @Models, not Sendable) never cross into the concurrent fetch tasks.
    private struct Snapshot: Sendable {
        let tmdbId: Int
        let type: MediaType
    }

    /// Enrich the watchlist. By default only items not already enriched are
    /// processed — so adding one title doesn't re-run the (SwiftData + TMDB)
    /// work for the whole list on every re-appear. `force` re-does everything
    /// (used by pull-to-refresh).
    func refresh(_ entries: [WatchlistEntry], library: Library, force: Bool = false) async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false; isLoaded = true }

        let snapshots = entries
            .filter { force || extrasByKey[Self.key($0.tmdbId, $0.mediaType)] == nil }
            .map { Snapshot(tmdbId: $0.tmdbId, type: $0.mediaType) }
        guard !snapshots.isEmpty else { return }

        // Fetch details concurrently (bounded) — one-at-a-time would make the
        // first (uncached) load painfully slow behind the skeletons. Results
        // are applied on the main actor as they arrive.
        await withTaskGroup(of: (Snapshot, TmdbItem?).self) { group in
            let maxConcurrent = 6
            var next = 0
            func schedule() {
                guard next < snapshots.count else { return }
                let s = snapshots[next]; next += 1
                group.addTask { (s, try? await TMDBClient.shared.details(id: s.tmdbId, type: s.type)) }
            }
            for _ in 0..<maxConcurrent { schedule() }
            for await (s, item) in group {
                if let item { apply(s, item: item, library: library) }
                schedule()
            }
        }
    }

    private func apply(_ s: Snapshot, item: TmdbItem, library: Library) {
        let k = Self.key(s.tmdbId, s.type)
        let isUp = Release.isUpcoming(item, s.type)
        if isUp { upcoming.insert(k) } else { upcoming.remove(k) }

        // Cache the display values so the grid cell can hand them to MediaCard,
        // which then skips its own enrich() entirely while scrolling.
        extrasByKey[k] = Extras(
            year: item.year.map(String.init),
            rating: (item.voteAverage ?? 0) > 0 ? String(format: "%.1f", item.voteAverage!) : nil,
            releaseText: Release.compactStatus(item, s.type),
            isUpcoming: isUp
        )
    }
}
