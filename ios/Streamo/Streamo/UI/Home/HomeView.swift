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
                if let error = model.errorMessage, !model.rows.values.contains(where: { !$0.isEmpty }) {
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
                    heroSection
                    Top10Row(items: model.top10)
                    continueWatchingRow
                    ForEach(HomeSections.rows) { section in
                        SectionRow(section: section, items: model.items(for: section), loading: model.isLoading)
                    }
                }
            }
            .padding(.bottom, 12)
        }
        // Let the hero bleed up behind the status bar / nav bar; the toolbar
        // buttons float over it.
        .ignoresSafeArea(edges: .top)
        // No page title on the home screen — the hero leads instead.
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        // No full-page spinner: the section rows render skeleton cards while
        // loading (web is skeleton-first, never a centered spinner).
        .task { await model.loadIfNeeded() }
        .task(id: library.version) { continueItems = await library.continueRows(); continueLoaded = true }
        .confirmationDialog(confirmMessage,
                            isPresented: .isPresent($pendingAction),
                            titleVisibility: .visible) {
            Button(confirmActionLabel, role: .destructive) { pendingAction?(); pendingAction = nil }
            Button("Annulla", role: .cancel) { pendingAction = nil }
        }
    }

    @ViewBuilder
    private var heroSection: some View {
        let heroes = model.heroItems
        if !heroes.isEmpty {
            HomeHero(items: heroes)
        } else if model.isLoading {
            HomeHeroSkeleton()
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
                                          aspectRatio: 16.0 / 9.0, alwaysShowInfo: true)
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
            .glassPanel(cornerRadius: 14)
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
