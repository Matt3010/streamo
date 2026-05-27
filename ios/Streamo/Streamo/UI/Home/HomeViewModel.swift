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
    private var hasLoaded = false

    init(client: TMDBClient = .shared) {
        self.client = client
    }

    func loadIfNeeded() async {
        guard !hasLoaded else { return }
        hasLoaded = true
        await reload()
    }

    func reload() async {
        isLoading = true
        errorMessage = nil
        await withTaskGroup(of: (String, [TmdbItem]?).self) { group in
            for section in HomeSections.all {
                group.addTask { [client] in
                    let items = try? await client.list(section.endpoint)
                    return (section.id, items)
                }
            }
            for await (id, items) in group {
                // Always record the outcome (even an empty/failed fetch) so a
                // completed-but-empty row stops showing skeletons forever.
                rows[id] = items ?? []
            }
        }
        if !rows.values.contains(where: { !$0.isEmpty }) {
            errorMessage = AppSettings.shared.hasTmdbKey
                ? "Impossibile caricare il catalogo. Controlla la connessione."
                : "Aggiungi la tua chiave API TMDB nelle Impostazioni."
        }
        isLoading = false
    }

    func items(for section: HomeSection) -> [TmdbItem] {
        rows[section.id] ?? []
    }
}
