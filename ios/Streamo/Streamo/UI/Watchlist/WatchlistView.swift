import SwiftUI

struct WatchlistView: View {
    @Environment(Library.self) private var library
    @State private var pendingRemove: WatchlistEntry?
    @State private var searchText = ""
    @AppStorage("watchlistTypeFilter") private var typeFilterRaw = "all"

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

    @ViewBuilder
    private func content(_ filtered: [WatchlistEntry]) -> some View {
        LazyVStack(spacing: 8) {
            ForEach(filtered, id: \.persistentModelID) { entry in
                cell(entry)
            }
        }
        .padding(.horizontal)
    }

    // MARK: - Text rows

    private func cell(_ entry: WatchlistEntry) -> some View {
        NavigationLink(value: MediaRef(tmdbId: entry.tmdbId, mediaType: entry.mediaType)) {
            HStack(spacing: 12) {
                Image(systemName: entry.mediaType == .tv ? "tv" : "film")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.red)
                    .frame(width: 34, height: 34)
                    .glassPanel(cornerRadius: 9, tint: 0.05, stroke: 0.08)

                VStack(alignment: .leading, spacing: 4) {
                    Text(displayTitle(entry))
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)

                    HStack(spacing: 8) {
                        Text(typeLabel(entry.mediaType))
                        Text(statusLabel(entry.status))
                    }
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                }

                Spacer(minLength: 8)

                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
            .glassPanel(cornerRadius: 14)
        }
        .buttonStyle(.plain)
        .contextMenu { menu(for: entry) }
    }

    private func typeLabel(_ type: MediaType) -> String {
        switch type {
        case .movie: return "Film"
        case .tv: return "Serie"
        }
    }

    private func displayTitle(_ entry: WatchlistEntry) -> String {
        let title = entry.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return title.isEmpty ? UIText.untitled : title
    }

    private func statusLabel(_ status: WatchlistStatus) -> String {
        switch status {
        case .todo: return "Da guardare"
        case .inProgress: return "In corso"
        case .done: return "Completato"
        }
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
