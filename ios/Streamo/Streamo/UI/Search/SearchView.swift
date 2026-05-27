import SwiftUI

struct SearchView: View {
    @Environment(Library.self) private var library
    @State private var query = ""
    @State private var results: [TmdbItem] = []
    @State private var isSearching = false
    @State private var pendingRemove: TmdbItem?
    @State private var pendingRemoveType: MediaType = .movie

    private let columns = [GridItem(.adaptive(minimum: 140), spacing: 14)]

    var body: some View {
        let _ = library.version
        ScrollView {
            if query.trimmingCharacters(in: .whitespaces).count < 2 {
                ContentUnavailableView("Cerca film e serie TV", systemImage: "magnifyingglass")
                    .padding(.top, 80)
            } else if isSearching && results.isEmpty {
                LazyVGrid(columns: columns, spacing: 18) {
                    ForEach(0..<9, id: \.self) { _ in SkeletonCard() }
                }
                .padding()
            } else if results.isEmpty {
                ContentUnavailableView.search(text: query)
                    .padding(.top, 80)
            } else {
                LazyVGrid(columns: columns, spacing: 18) {
                    ForEach(results) { item in
                        resultCell(item)
                    }
                }
                .padding()
            }
        }
        .navigationTitle("Cerca")
        .searchable(text: $query, prompt: "Titolo, serie, film…")
        .confirmationDialog("Rimuovere \(pendingRemove?.displayTitle ?? "questo titolo") dalla lista?",
                            isPresented: Binding(get: { pendingRemove != nil }, set: { if !$0 { pendingRemove = nil } }),
                            titleVisibility: .visible) {
            Button("Rimuovi", role: .destructive) {
                if let it = pendingRemove {
                    library.removeFromWatchlist(it.id, pendingRemoveType)
                    ToastCenter.shared.show("Rimosso dalla lista")
                }
                pendingRemove = nil
            }
            Button("Annulla", role: .cancel) { pendingRemove = nil }
        }
        .refreshable { await runSearch(query) }
        // Debounce: re-run 350ms after the query stops changing.
        .task(id: query) {
            let current = query
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled, current == query else { return }
            await runSearch(current)
        }
    }

    @ViewBuilder
    private func resultCell(_ item: TmdbItem) -> some View {
        let type: MediaType = item.mediaType == "tv" ? .tv : .movie
        let inList = library.isInWatchlist(item.id, type)
        NavigationLink(value: MediaRef(tmdbId: item.id, mediaType: type)) {
            MediaCard(card: CardItem(tmdb: item, type: type))
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button(role: inList ? .destructive : nil) {
                if inList {
                    pendingRemove = item; pendingRemoveType = type
                } else {
                    library.toggleWatchlist(item: item, type: type)
                    ToastCenter.shared.show("Aggiunto alla lista")
                }
            } label: {
                Label(inList ? "Rimuovi dalla lista" : "Aggiungi alla lista",
                      systemImage: inList ? "bookmark.slash" : "bookmark")
            }
        }
    }

    private func runSearch(_ q: String) async {
        let trimmed = q.trimmingCharacters(in: .whitespaces)
        // Like the web typeahead, require ≥2 chars before hitting TMDB.
        guard trimmed.count >= 2 else { results = []; return }
        isSearching = true
        defer { isSearching = false }
        results = (try? await TMDBClient.shared.searchMulti(trimmed)) ?? []
    }
}
