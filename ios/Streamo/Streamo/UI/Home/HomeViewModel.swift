import Foundation
import Observation

/// Loads every home row from TMDB concurrently. UI-facing state is updated on
/// the main actor.
@MainActor
@Observable
final class HomeViewModel {
    private(set) var rows: [String: [TmdbItem]] = [:]
    private(set) var isLoading = false
    private(set) var errorMessage: String?

    private let client: TMDBClient

    init(client: TMDBClient = .shared) {
        self.client = client
    }

    /// Loads on first appearance, and retries on a later one while the hero is
    /// still empty — so a partial load (e.g. trending failed while the tunnel
    /// warmed, leaving the rows but no hero) recovers by re-entering the tab,
    /// without a manual pull-to-refresh.
    func loadIfNeeded() async {
        guard heroItems.isEmpty, !isLoading else { return }
        await reload()
    }

    func reload() async {
        isLoading = true
        errorMessage = nil
        await fetchAllRows()
        if !rows.values.contains(where: { !$0.isEmpty }) {
            errorMessage = AppSettings.shared.hasTmdbKey
                ? "Impossibile caricare il catalogo. Controlla la connessione."
                : "Aggiungi la tua chiave API TMDB nelle Impostazioni."
        }
        isLoading = false
    }

    /// One concurrent pass over every home row. Only a non-empty result
    /// overwrites an existing row, so a transient failure on pull-to-refresh
    /// keeps the previously-loaded content instead of blanking the screen.
    private func fetchAllRows() async {
        await withTaskGroup(of: (String, [TmdbItem]?).self) { group in
            for section in HomeSections.all {
                group.addTask { [client] in
                    let items = try? await client.list(section.endpoint)
                    return (section.id, items)
                }
            }
            for await (id, items) in group {
                if let items, !items.isEmpty {
                    rows[id] = items
                } else if rows[id] == nil {
                    // Record the empty outcome so the row stops showing skeletons.
                    rows[id] = []
                }
            }
        }
    }

    func items(for section: HomeSection) -> [TmdbItem] {
        rows[section.id] ?? []
    }

    /// One trending item paired with its media type, ready for the home hero.
    struct HeroItem: Identifiable, Hashable {
        let item: TmdbItem
        let mediaType: MediaType
        var id: String { "\(mediaType.rawValue)-\(item.id)" }
    }

    /// The most in-vogue titles right now: trending films + series of the day,
    /// merged and ranked by popularity. Only items with artwork qualify (the
    /// hero is image-led). Capped to a short carousel.
    var heroItems: [HeroItem] {
        Array(trendingRanked(requirePoster: false).prefix(6))
    }

    /// The ranked Top 10 of the day: trending films + series merged and sorted
    /// by popularity. Requires a poster (the row is poster-led) and excludes
    /// whatever the hero is already showcasing, so the two don't repeat titles.
    var top10: [HeroItem] {
        let heroIDs = Set(heroItems.map(\.id))
        return Array(
            trendingRanked(requirePoster: true)
                .filter { !heroIDs.contains($0.id) }
                .prefix(10)
        )
    }

    /// Trending films + series merged and ranked by popularity.
    private func trendingRanked(requirePoster: Bool) -> [HeroItem] {
        let movies = (rows["movie-trending"] ?? []).map { HeroItem(item: $0, mediaType: .movie) }
        let series = (rows["tv-trending"] ?? []).map { HeroItem(item: $0, mediaType: .tv) }
        return (movies + series)
            .filter { requirePoster ? $0.item.posterPath != nil
                                     : ($0.item.backdropPath != nil || $0.item.posterPath != nil) }
            .sorted { ($0.item.popularity ?? 0) > ($1.item.popularity ?? 0) }
    }
}
