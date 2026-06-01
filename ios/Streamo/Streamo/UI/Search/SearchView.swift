import SwiftUI

struct SearchView: View {
    @Environment(Library.self) private var library
    @Environment(AppNavigation.self) private var nav
    @State private var query = ""
    @State private var results: [TmdbItem] = []
    @State private var isSearching = false
    @State private var isSearchPresented = false
    @State private var pendingRemove: TmdbItem?
    @State private var pendingRemoveType: MediaType = .movie

    private let columns = [GridItem(.adaptive(minimum: 140), spacing: 14)]

    // Recent searches, persisted (web `streamo.search.recent`, max 8).
    @AppStorage("recentSearches") private var recentsRaw = "[]"
    private let recentsLimit = 8

    private var recents: [String] {
        (try? JSONDecoder().decode([String].self, from: Data(recentsRaw.utf8))) ?? []
    }
    private func setRecents(_ arr: [String]) {
        let data = (try? JSONEncoder().encode(arr)) ?? Data("[]".utf8)
        recentsRaw = String(decoding: data, as: UTF8.self)
    }
    private func addRecent(_ term: String) {
        let t = term.trimmingCharacters(in: .whitespaces)
        guard t.count >= 2 else { return }
        var arr = recents.filter { $0.lowercased() != t.lowercased() }   // dedupe, case-insensitive
        arr.insert(t, at: 0)                                             // newest first
        setRecents(Array(arr.prefix(recentsLimit)))
    }
    private func removeRecent(_ term: String) { setRecents(recents.filter { $0 != term }) }

    var body: some View {
        let _ = library.version
        ScrollView {
            if query.trimmingCharacters(in: .whitespaces).count < 2 {
                if recents.isEmpty {
                    ContentUnavailableView("Cerca film e serie TV", systemImage: "magnifyingglass")
                        .padding(.top, 80)
                } else {
                    recentsView
                }
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
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, isPresented: $isSearchPresented, prompt: "Titolo, film o serie TV")
        // Re-open the keyboard whenever the Search tab is tapped (the search may
        // have dismissed it).
        .onChange(of: nav.searchFocusRequest) { _, _ in
            isSearchPresented = true
        }
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                isSearchPresented = true
            }
        }
        .onSubmit(of: .search) { addRecent(query) }
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

    private var recentsView: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Recenti").font(.headline)
                Spacer()
                Button("Cancella") { setRecents([]) }
                    .font(.subheadline).foregroundStyle(Theme.red)
            }
            .padding(.horizontal).padding(.top, 12).padding(.bottom, 6)

            ForEach(Array(recents.enumerated()), id: \.element) { index, term in
                HStack(spacing: 12) {
                    Button {
                        addRecent(term)   // move to front
                        query = term      // re-runs via the debounce task
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "clock.arrow.circlepath").foregroundStyle(.secondary)
                            Text(term).foregroundStyle(.primary).lineLimit(1)
                            Spacer()
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)

                    Button { removeRecent(term) } label: {
                        Image(systemName: "xmark")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .frame(width: 32, height: 32)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal)
                .padding(.vertical, 8)
                .contentShape(Rectangle())
                if index < recents.count - 1 {
                    Divider().padding(.leading, 44)
                }
            }
        }
        .background {
            LiquidGlassBackground(shape: RoundedRectangle(cornerRadius: 16, style: .continuous), tint: Theme.red.opacity(0.06))
        }
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(.white.opacity(0.10)))
        .padding(.horizontal)
        .padding(.top, 8)
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
