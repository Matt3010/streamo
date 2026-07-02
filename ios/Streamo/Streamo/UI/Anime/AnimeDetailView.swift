import SwiftUI

/// Native AnimeUnity detail page — poster, synopsis and an episode grid pulled
/// straight from `/info_api`. No TMDB: everything here is AnimeUnity data.
/// Playback/progress/history are tagged `source: .animeUnity` so they never
/// collide with the TMDB library. Downloads are TMDB-only for now (streaming
/// only in this first cut).
///
/// `info_api` caps the episode window at 120, so long runs (One Piece, 1000+)
/// are paged: a "1 - 120 / 121 - 240 / …" range selector loads one window at a
/// time (faster than fetching everything up front).
struct AnimeDetailView: View {
    let anime: AUAnime

    @Environment(Library.self) private var library
    @State private var episodes: [AUEpisode] = []
    @State private var episodeTotal = 0
    @State private var selectedRange = 0
    @State private var isLoading = true
    @State private var loadingWindow = false
    @State private var loadFailed = false
    @State private var pendingRequest: PlaybackRequest?
    @State private var synopsisExpanded = false

    private var isMovie: Bool { (anime.type ?? "").caseInsensitiveCompare("Movie") == .orderedSame }
    private var chunk: Int { AnimeUnityClient.episodeChunk }

    private let columns = [GridItem(.adaptive(minimum: 56), spacing: 10)]

    var body: some View {
        let _ = library.version   // re-read episode progress after playback
        return ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header.padding(.horizontal, 16)
                if let plot = anime.plot, !plot.isEmpty { synopsis(plot).padding(.horizontal, 16) }
                episodesSection
            }
            .padding(.bottom, 40)
        }
        .navigationTitle(anime.displayTitle)
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadInitial() }
        .fullScreenCover(item: $pendingRequest) { PlayerScreen(request: $0) }
    }

    // MARK: - Header

    private var header: some View {
        HStack(alignment: .top, spacing: 14) {
            PosterImage(url: URL(string: anime.imageurl ?? ""), contentMode: .fill)
                .aspectRatio(2.0/3.0, contentMode: .fill)
                .frame(width: 120)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

            VStack(alignment: .leading, spacing: 8) {
                Text(anime.displayTitle).font(.title3.weight(.bold))
                HStack(spacing: 8) {
                    if let type = anime.type { FilterChip(label: type, selected: false, compact: true) {} }
                    if let year = anime.year { FilterChip(label: String(year), selected: false, compact: true) {} }
                    FilterChip(label: anime.isDubbed ? "ITA" : "SUB ITA", selected: false, compact: true) {}
                }
                if let status = anime.status { Text(status).font(.caption).foregroundStyle(.secondary) }

                if isMovie {
                    Button { playMovie() } label: { Label("Guarda", systemImage: "play.fill") }
                        .buttonStyle(BrandButtonStyle(kind: .primary, fullWidth: true))
                        .disabled(episodes.isEmpty)
                        .padding(.top, 4)
                }
            }
        }
    }

    private func synopsis(_ plot: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(plot)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(synopsisExpanded ? nil : 4)
            Button(synopsisExpanded ? "Mostra meno" : "Mostra tutto") {
                withAnimation { synopsisExpanded.toggle() }
            }
            .font(.caption.weight(.semibold))
            .tint(Theme.red)
        }
    }

    // MARK: - Episodes

    @ViewBuilder
    private var episodesSection: some View {
        if isMovie {
            EmptyView()
        } else if isLoading {
            ProgressView().tint(Theme.red).frame(maxWidth: .infinity).padding(.top, 30)
        } else if loadFailed {
            VStack(spacing: 10) {
                Text("Impossibile caricare gli episodi.").font(.subheadline).foregroundStyle(.secondary)
                Button("Riprova") { Task { await loadInitial() } }
                    .buttonStyle(BrandButtonStyle(kind: .secondary, fullWidth: false))
            }
            .frame(maxWidth: .infinity).padding(.top, 20)
        } else if episodeTotal == 0 {
            Text("Nessun episodio disponibile.")
                .font(.subheadline).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity).padding(.top, 20)
        } else {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader(title: "Episodi", symbol: "play.square.stack")
                if rangeCount > 1 { rangeSelector }
                grid
            }
        }
    }

    /// "1 - 120 / 121 - 240 / …" window tabs (reuses `FilterChip`).
    private var rangeSelector: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(0..<rangeCount, id: \.self) { i in
                    let (s, e) = rangeBounds(i)
                    FilterChip(label: "\(s) - \(e)", selected: i == selectedRange, compact: true) {
                        Task { await selectRange(i) }
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }

    @ViewBuilder
    private var grid: some View {
        if loadingWindow {
            ProgressView().tint(Theme.red).frame(maxWidth: .infinity).padding(.vertical, 30)
        } else {
            LazyVGrid(columns: columns, spacing: 10) {
                ForEach(Array(episodes.enumerated()), id: \.element.id) { idx, ep in
                    episodeCell(ep, coordinate: episodeNumber(ep, windowIndex: idx))
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private func episodeCell(_ ep: AUEpisode, coordinate: Int) -> some View {
        let prog = library.progress(anime.id, .tv, season: 1, episode: coordinate, source: .animeUnity)
        let pos = prog?.position ?? 0, dur = prog?.duration ?? 0
        let pct = dur > 0 ? min(1, pos / dur) : 0
        let watched = TVLogic.isWatched(position: pos, duration: dur)
        let inProgress = pct > 0 && !watched
        return Button {
            playEpisode(ep, coordinate: coordinate, resumeAt: watched ? 0 : (prog?.position ?? 0))
        } label: {
            Text(ep.number ?? "\(coordinate)")
                .font(.callout.weight(.semibold))
                .lineLimit(1).minimumScaleFactor(0.7)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(Color.secondary.opacity(watched ? 0.08 : 0.18))
                // Shared ProgressBar (square variant) pinned to the cell's
                // bottom edge — its track keeps it visible even at ~2%.
                .overlay(alignment: .bottom) {
                    if inProgress { ProgressBar(percent: pct * 100, rounded: false) }
                }
                .overlay(alignment: .topTrailing) {
                    if watched {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.caption2).foregroundStyle(Theme.red).padding(3)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .strokeBorder(inProgress ? Theme.red : .clear, lineWidth: 1.5)
                )
                .foregroundStyle(watched ? .secondary : .primary)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Range math

    private var rangeCount: Int { episodeTotal == 0 ? 0 : (episodeTotal + chunk - 1) / chunk }

    private func rangeBounds(_ i: Int) -> (Int, Int) {
        (i * chunk + 1, min((i + 1) * chunk, episodeTotal))
    }

    /// Absolute episode number: trust AnimeUnity's own number, falling back to
    /// the window offset for the rare entry that omits it.
    private func episodeNumber(_ ep: AUEpisode, windowIndex: Int) -> Int {
        ep.numberInt ?? (rangeBounds(selectedRange).0 + windowIndex)
    }

    // MARK: - Actions

    private func playMovie() {
        guard let ep = episodes.first else { return }
        let prog = library.progress(anime.id, .movie, season: 0, episode: 0, source: .animeUnity)
        pendingRequest = makeRequest(ep: ep, mediaType: .movie, season: 0, episode: 0, resumeAt: prog?.position ?? 0)
    }

    private func playEpisode(_ ep: AUEpisode, coordinate: Int, resumeAt: Double) {
        pendingRequest = makeRequest(ep: ep, mediaType: .tv, season: 1, episode: coordinate, resumeAt: resumeAt)
    }

    private func makeRequest(ep: AUEpisode, mediaType: MediaType, season: Int, episode: Int, resumeAt: Double) -> PlaybackRequest {
        let title = mediaType == .movie ? anime.displayTitle : "\(anime.displayTitle) • Ep. \(ep.number ?? "\(episode)")"
        return PlaybackRequest(
            tmdbId: anime.id, mediaType: mediaType, title: title, releaseDate: anime.date,
            poster: anime.imageurl, season: season, episode: episode, startAt: resumeAt,
            source: .animeUnity, animeSlug: anime.slug, animeEpisodeId: ep.id,
            artworkURLString: anime.imageurlCover ?? anime.imageurl
        )
    }

    // MARK: - Loading

    private func loadInitial() async {
        isLoading = true
        loadFailed = false
        guard await ProviderResolver.shared.ensureAnimeSession() else {
            isLoading = false; loadFailed = true; return
        }
        do {
            let page = try await AnimeUnityClient.shared.episodePage(animeId: anime.id, start: 1, end: chunk)
            episodeTotal = page.total
            episodes = page.episodes
            selectedRange = 0
        } catch {
            loadFailed = true
        }
        isLoading = false
    }

    private func selectRange(_ i: Int) async {
        guard i != selectedRange, !loadingWindow else { return }
        selectedRange = i
        loadingWindow = true
        defer { loadingWindow = false }
        let (start, end) = rangeBounds(i)
        guard await ProviderResolver.shared.ensureAnimeSession() else { return }
        if let page = try? await AnimeUnityClient.shared.episodePage(animeId: anime.id, start: start, end: end) {
            episodes = page.episodes
        }
    }
}
