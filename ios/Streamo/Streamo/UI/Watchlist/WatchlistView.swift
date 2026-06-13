import SwiftUI

struct WatchlistView: View {
    @Environment(Library.self) private var library
    @State private var enrichment = WatchlistEnrichment()
    @State private var pendingRemove: WatchlistEntry?
    @AppStorage("watchlistTypeFilter") private var typeFilterRaw = "all"

    private let columns = [GridItem(.adaptive(minimum: 140), spacing: 14)]

    private enum TypeFilter: String { case all, tv, movie }
    private var typeFilter: TypeFilter { TypeFilter(rawValue: typeFilterRaw) ?? .all }

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
                    empty("Nessun titolo", "Cambia filtro per vedere altri titoli.")
                } else {
                    content(filtered)
                }
            }
            .padding(.vertical, 8)
        }
        .navigationTitle("La mia lista")
        .navigationBarTitleDisplayMode(.inline)
        // Enrich once on appear to derive year/rating/upcoming for the cards.
        // Skeletons cover this first pass; afterwards derived display values are
        // kept so the grid scrolls smoothly.
        .task { await enrichment.refresh(all, library: library) }
        .refreshable { await enrichment.refresh(library.watchlist(), library: library, force: true) }
        .confirmationDialog("Rimuovere \(pendingRemove?.title ?? "questo titolo") dalla lista?",
                            isPresented: Binding(get: { pendingRemove != nil }, set: { if !$0 { pendingRemove = nil } }),
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
        FlowLayout(spacing: 8) {
            typeChip("Tutti", .all)
            typeChip("TV", .tv)
            typeChip("Film", .movie)
        }
        .padding(.horizontal)
    }

    private func typeChip(_ label: String, _ value: TypeFilter) -> some View {
        FilterChip(label: label, selected: typeFilter == value, compact: true) { typeFilterRaw = value.rawValue }
    }

    private func applyFilters(_ items: [WatchlistEntry]) -> [WatchlistEntry] {
        items.filter { typeFilter == .all || $0.mediaTypeRaw == typeFilter.rawValue }
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
        } label: { Label("Rimuovi dalla lista", systemImage: "trash") }
    }

    private func empty(_ title: String, _ hint: String) -> some View {
        ContentUnavailableView(title, systemImage: "bookmark", description: Text(hint))
            .padding(.top, 60)
    }
}
