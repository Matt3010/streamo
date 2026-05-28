import SwiftUI

struct HomeView: View {
    @State private var model = HomeViewModel()
    @Environment(Library.self) private var library
    @Environment(AppNavigation.self) private var nav
    @Environment(\.horizontalSizeClass) private var hSizeClass

    @State private var confirmMessage = ""
    @State private var confirmActionLabel = "Rimuovi"
    @State private var pendingAction: (() -> Void)?
    @State private var continueItems: [Library.ContinueRow] = []
    @State private var continueLoaded = false

    private func askConfirm(_ message: String, _ actionLabel: String, _ action: @escaping () -> Void) {
        confirmMessage = message
        confirmActionLabel = actionLabel
        pendingAction = action
    }

    var body: some View {
        let _ = library.version

        ScrollView {
            LazyVStack(alignment: .leading, spacing: 24) {
                if let error = model.errorMessage, model.rows.isEmpty {
                    ContentUnavailableView {
                        Label("Catalogo non disponibile", systemImage: "film.stack")
                    } description: {
                        Text(error)
                    } actions: {
                        if AppSettings.shared.hasTmdbKey {
                            Button("Riprova") { Task { await model.reload() } }
                                .buttonStyle(BrandButtonStyle(kind: .primary, fullWidth: false))
                        } else {
                            Button("Apri Impostazioni") { nav.presentedSheet = .settings }
                                .buttonStyle(BrandButtonStyle(kind: .primary, fullWidth: false))
                        }
                    }
                    .padding(.top, 60)
                } else {
                    continueWatchingRow
                    myListRow
                    ForEach(HomeSections.all) { section in
                        SectionRow(section: section, items: model.items(for: section), loading: model.isLoading)
                    }
                }
            }
            .padding(.vertical, 12)
        }
        .navigationTitle("Streamo")
        .toolbarTitleDisplayMode(.large)
        // No full-page spinner: the section rows render skeleton cards while
        // loading (web is skeleton-first, never a centered spinner).
        .task { await model.loadIfNeeded() }
        .task(id: library.version) { continueItems = await library.continueRows(); continueLoaded = true }
        .refreshable { await model.reload() }
        .confirmationDialog(confirmMessage,
                            isPresented: Binding(get: { pendingAction != nil }, set: { if !$0 { pendingAction = nil } }),
                            titleVisibility: .visible) {
            Button(confirmActionLabel, role: .destructive) { pendingAction?(); pendingAction = nil }
            Button("Annulla", role: .cancel) { pendingAction = nil }
        }
    }

    @ViewBuilder
    private var continueWatchingRow: some View {
        if !continueItems.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title: "Continua a guardare", symbol: "play.fill")
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 14) {
                        ForEach(continueItems) { entry in
                            NavigationLink(value: MediaRef(tmdbId: entry.tmdbId, mediaType: entry.mediaType,
                                                           resumeSeason: entry.season, resumeEpisode: entry.episode)) {
                                MediaCard(card: CardItem(continue: entry), showProgress: true, showWatchStatus: true,
                                          library: library, width: MediaCard.continueWidth(hSizeClass),
                                          aspectRatio: 16.0 / 9.0)
                            }
                            .buttonStyle(.plain)
                            .contextMenu {
                                Button {
                                    askConfirm("Nascondere \(entry.title ?? "questo titolo") da Continua a guardare?", "Nascondi") {
                                        library.hideFromContinue(entry.tmdbId, entry.mediaType)
                                        ToastCenter.shared.show("Nascosto da Continua a guardare")
                                    }
                                } label: { Label("Nascondi", systemImage: "eye.slash") }
                            }
                        }
                    }
                    .padding(.horizontal)
                }
            }
        } else if continueLoaded {
            emptyRow(title: "Continua a guardare", symbol: "play.fill",
                     message: "Niente da riprendere",
                     hint: "I titoli che inizi a guardare compariranno qui.", action: nil)
        }
    }

    @ViewBuilder
    private var myListRow: some View {
        let items = library.watchlist()
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title: "La mia lista", symbol: "bookmark.fill")
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 14) {
                        ForEach(items, id: \.persistentModelID) { entry in
                            NavigationLink(value: MediaRef(tmdbId: entry.tmdbId, mediaType: entry.mediaType)) {
                                MediaCard(card: CardItem(watchlist: entry), showWatchStatus: true,
                                          library: library, width: MediaCard.rowWidth(hSizeClass))
                            }
                            .buttonStyle(.plain)
                            .contextMenu {
                                Button(role: .destructive) {
                                    askConfirm("Rimuovere \(entry.title ?? "questo titolo") dalla lista?", "Rimuovi") {
                                        library.removeFromWatchlist(entry.tmdbId, entry.mediaType)
                                        ToastCenter.shared.show("Rimosso dalla lista")
                                    }
                                } label: { Label("Rimuovi dalla lista", systemImage: "trash") }
                            }
                        }
                    }
                    .padding(.horizontal)
                }
            }
        } else {
            emptyRow(title: "La mia lista", symbol: "bookmark.fill",
                     message: "La tua lista è vuota",
                     hint: "Aggiungi un film o una serie con il segnalibro per ritrovarli qui.",
                     action: ("Vai a cercare", { nav.selectedTab = .search }))
        }
    }

    @ViewBuilder
    private func emptyRow(title: String, symbol: String, message: String, hint: String,
                          action: (label: String, run: () -> Void)?) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: title, symbol: symbol)
            VStack(alignment: .leading, spacing: 10) {
                Text(message).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                Text(hint).font(.caption).foregroundStyle(.secondary)
                if let action {
                    Button(action.label) { action.run() }
                        .buttonStyle(BrandButtonStyle(kind: .primary, fullWidth: false))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(.white.opacity(0.10)))
            .padding(.horizontal)
        }
    }
}

/// One horizontally-scrolling row of poster cards.
private struct SectionRow: View {
    let section: HomeSection
    let items: [TmdbItem]
    let loading: Bool
    @Environment(\.horizontalSizeClass) private var hSizeClass

    var body: some View {
        // A row that finished loading with no items (failed/empty endpoint) is
        // hidden rather than left showing skeletons forever.
        if items.isEmpty && !loading {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title: section.title, symbol: section.symbol)

                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 14) {
                        if items.isEmpty {
                            ForEach(0..<6, id: \.self) { _ in
                                SkeletonCard(width: MediaCard.rowWidth(hSizeClass))
                            }
                        } else {
                        ForEach(items) { item in
                            NavigationLink(value: MediaRef(tmdbId: item.id, mediaType: section.mediaType)) {
                                MediaCard(card: CardItem(tmdb: item, type: section.mediaType), width: MediaCard.rowWidth(hSizeClass))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.horizontal)
            }
            }
        }
    }
}
