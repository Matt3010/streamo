import SwiftUI

/// The "Anime" tab root: an AnimeUnity-native "Continua a guardare" row (same
/// `MediaCard` as the film section) on top of the browse grid with live search.
/// Tapping a catalog card pushes `AnimeDetailView`; tapping a continue card
/// resumes the episode straight away.
struct AnimeCatalogView: View {
    @Environment(Library.self) private var library
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var model = AnimeCatalogModel()

    private let columns = [GridItem(.adaptive(minimum: 140), spacing: 14)]

    /// Continue row is hidden while searching (you're looking for something new).
    private var continueRows: [ProgressEntry] {
        model.isSearching || !model.query.isEmpty ? [] : library.animeContinueRows()
    }

    var body: some View {
        let _ = library.version   // re-read continue rows after playback
        ScrollView {
            if model.items.isEmpty, model.loadFailed {
                ContentUnavailableView {
                    Label("Catalogo non disponibile", systemImage: "wifi.exclamationmark")
                } description: {
                    Text("Impossibile caricare AnimeUnity.")
                } actions: {
                    Button("Riprova") { Task { await model.retry() } }
                        .buttonStyle(BrandButtonStyle(kind: .secondary, fullWidth: false))
                }
                .padding(.top, 60)
            } else if model.items.isEmpty, model.isLoading {
                LazyVGrid(columns: columns, spacing: 18) {
                    ForEach(0..<9, id: \.self) { _ in SkeletonCard() }
                }
                .padding()
            } else if model.items.isEmpty {
                ContentUnavailableView.search(text: model.query)
                    .padding(.top, 80)
            } else {
                if !continueRows.isEmpty { continueSection }
                catalogGrid
            }
        }
        .navigationTitle("Anime")
        .searchable(text: $model.query, prompt: "Cerca un anime")
        .task { await model.loadInitialIfNeeded() }
    }

    // MARK: - Continua a guardare (same landscape card as the film section)

    private var continueSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "Continua a guardare", symbol: "play.fill")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 14) {
                    ForEach(continueRows) { p in
                        NavigationLink(value: AUAnime.stub(id: p.tmdbId, title: p.animeTitleBase,
                                                           slug: p.providerSlug, imageurl: p.poster)) {
                            MediaCard(card: CardItem(animeProgress: p), showProgress: true,
                                      showWatchStatus: true, library: library,
                                      width: MediaCard.continueWidth(hSize),
                                      aspectRatio: 16.0 / 9.0, alwaysShowInfo: true)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
            }
        }
        .padding(.top, 8)
        .padding(.bottom, 4)
    }

    // MARK: - Browse grid

    private var catalogGrid: some View {
        VStack(spacing: 0) {
            LazyVGrid(columns: columns, spacing: 18) {
                ForEach(model.items) { anime in
                    NavigationLink(value: anime) {
                        MediaCard(card: CardItem(anime: anime), alwaysShowInfo: true)
                            .overlay(alignment: .topTrailing) { dubBadge(anime) }
                    }
                    .buttonStyle(.plain)
                    .simultaneousGesture(TapGesture().onEnded {
                        model.preserveSearchWhileOpeningResult()
                    })
                    .task { await model.loadMoreIfNeeded(currentItem: anime) }
                }
            }
            .padding()

            if model.isLoading, !model.isSearching {
                ProgressView().tint(Theme.red).padding(.vertical, 20)
            }
        }
    }

    /// "ITA" dub pill, inset from the card's rounded top-right corner. Overlaid
    /// outside `MediaCard` so the inset clears the corner radius cleanly.
    @ViewBuilder
    private func dubBadge(_ anime: AUAnime) -> some View {
        if anime.isDubbed {
            Text("ITA")
                .font(.caption2.weight(.bold))
                .padding(.horizontal, 6).padding(.vertical, 2)
                .background(.black.opacity(0.65), in: Capsule())
                .foregroundStyle(.white)
                .padding(8)
        }
    }
}
