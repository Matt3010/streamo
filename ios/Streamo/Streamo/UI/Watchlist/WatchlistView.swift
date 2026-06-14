import SwiftUI

struct WatchlistView: View {
    @Environment(Library.self) private var library
    @State private var enrichment = WatchlistEnrichment()
    @State private var pendingRemove: WatchlistEntry?
    @State private var searchText = ""
    @AppStorage("watchlistTypeFilter") private var typeFilterRaw = "all"

    private let columns = [GridItem(.adaptive(minimum: 140), spacing: 14)]

    private var typeFilter: MediaTypeFilter { MediaTypeFilter(rawValue: typeFilterRaw) ?? .all }

    var body: some View {
        let _ = library.version
        let all = library.watchlist()
        let filtered = applyFilters(all)

        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                filters

                if all.isEmpty {
                    empty("Lista vuota", "Aggiungi film e serie con il segnalibro.")
                } else if !enrichment.isLoaded {
                    skeletonGrid
                } else if filtered.isEmpty {
                    if searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        empty("Nessun titolo", "Cambia filtro per vedere altri titoli.")
                    } else {
                        empty("Nessun risultato", "Nessun titolo per \"\(searchText)\".")
                    }
                } else {
                    content(filtered)
                }
            }
            .padding(.vertical, 8)
        }
        .navigationTitle("La mia lista")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .always),
                    prompt: "Cerca nella lista")
        // Enrich once on appear to derive year/rating/upcoming for the cards.
        // Skeletons cover this first pass; afterwards derived display values are
        // kept so the grid scrolls smoothly.
        .task { await enrichment.refresh(all, library: library) }
        .refreshable { await enrichment.refresh(library.watchlist(), library: library, force: true) }
        .confirmationDialog("Rimuovere \(pendingRemove?.title ?? "questo titolo") dalla lista?",
                            isPresented: .isPresent($pendingRemove),
                            titleVisibility: .visible) {
            Button("Rimuovi", role: .destructive) {
                if let e = pendingRemove {
                    library.removeFromWatchlist(e.tmdbId, e.mediaType)
                    ToastCenter.shared.show("Rimosso dalla lista")
                }
                pendingRemove = nil
            }
            Button("Annulla", role: .cancel) { pendingRemove = nil }
        }
    }

    // MARK: - Filters

    private var filters: some View {
        MediaTypeFilterChips(rawValue: $typeFilterRaw, compact: true)
            .padding(.horizontal)
    }

    private func applyFilters(_ items: [WatchlistEntry]) -> [WatchlistEntry] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        return items.filter { entry in
            (typeFilter == .all || entry.mediaTypeRaw == typeFilter.rawValue)
            && (query.isEmpty || (entry.title ?? "").localizedCaseInsensitiveContains(query))
        }
    }

    /// Placeholder grid shown while the first enrichment pass runs, so the
    /// heavy work happens behind skeletons instead of lagging the live grid.
    private var skeletonGrid: some View {
        LazyVGrid(columns: columns, spacing: 18) {
            ForEach(0..<12, id: \.self) { _ in SkeletonCard() }
        }
        .padding(.horizontal)
    }

    @ViewBuilder
    private func content(_ filtered: [WatchlistEntry]) -> some View {
        LazyVGrid(columns: columns, spacing: 18) {
            ForEach(filtered, id: \.persistentModelID) { cell($0) }
        }
        .padding(.horizontal)
    }

    // MARK: - Grid cell

    @ViewBuilder
    private func cell(_ entry: WatchlistEntry) -> some View {
        NavigationLink(value: MediaRef(tmdbId: entry.tmdbId, mediaType: entry.mediaType)) {
            MediaCard(card: enrichedCard(entry), library: library)
        }
        .buttonStyle(.plain)
        .contextMenu { menu(for: entry) }
    }

    /// Build the card with the values enrichment already derived, so MediaCard
    /// has nothing left to fetch/compute and the grid scrolls smoothly.
    private func enrichedCard(_ entry: WatchlistEntry) -> CardItem {
        var card = CardItem(watchlist: entry)
        if let x = enrichment.extras(for: entry) {
            card.year = x.year
            card.rating = x.rating
            card.nextReleaseText = x.releaseText
            card.isUpcoming = x.isUpcoming
        }
        return card
    }

    @ViewBuilder
    private func menu(for entry: WatchlistEntry) -> some View {
        Button(role: .destructive) {
            pendingRemove = entry
        } label: { Label(UIText.removeFromList, systemImage: "trash") }
    }

    private func empty(_ title: String, _ hint: String) -> some View {
        ContentUnavailableView(title, systemImage: "bookmark", description: Text(hint))
            .padding(.top, 60)
    }
}
