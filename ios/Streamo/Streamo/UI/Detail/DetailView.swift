import SwiftUI

struct DetailView: View {
    let ref: MediaRef
    @State private var model: DetailViewModel
    @State private var pendingRequest: PlaybackRequest?
    @State private var showPicker = false
    @State private var confirmRemoveFromList = false
    @Environment(Library.self) private var library
    @Environment(\.openURL) private var openURL
    @Environment(\.horizontalSizeClass) private var hSizeClass

    init(ref: MediaRef) {
        self.ref = ref
        _model = State(initialValue: DetailViewModel(ref: ref))
    }

    var body: some View {
        // Subscribe to library writes so CTA / grid / bookmark refresh after
        // playback or watchlist changes.
        let _ = library.version

        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                // Spacer so the title/buttons sit over the lower (gradient) part
                // of the full-page backdrop, like the web watch page.
                Color.clear.frame(height: 110)

                VStack(alignment: .leading, spacing: 12) {
                    if let item = model.item {
                        Text(item.displayTitle).font(.title.bold())
                        actionRow(for: item)
                        metadata(for: item)
                    } else if model.isLoading {
                        detailSkeleton
                    } else if let err = model.loadError {
                        ContentUnavailableView {
                            Label("Errore", systemImage: "exclamationmark.triangle")
                        } description: {
                            Text(err)
                        } actions: {
                            Button("Riprova") { Task { await reloadDetail() } }
                                .buttonStyle(BrandButtonStyle(kind: .primary, fullWidth: false))
                        }
                    }
                }
                .frame(maxWidth: 760)            // cap the column (web caps at 800)
                .frame(maxWidth: .infinity)       // …centered on iPad / landscape
                .padding(.horizontal)

                if model.isTV, let item = model.item, !model.seasons.isEmpty {
                    episodesSection(for: item)
                }
                if model.extrasLoading {
                    extrasSkeleton
                } else {
                    if !model.reviews.isEmpty { reviewsSection }
                    if !model.recommendations.isEmpty { recommendationsSection }
                }
            }
            .padding(.bottom, 24)
        }
        .background(backdropBackground)
        .navigationTitle(model.item?.displayTitle ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if model.item != nil {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if let rank = model.rankBadge {
                        MediaRankBadge(value: rank)
                    }
                    Menu {
                        Button { markWatched() } label: { Label("Segna come visto", systemImage: "checkmark.circle") }
                        Button { markUnwatched() } label: { Label("Segna come da vedere", systemImage: "arrow.uturn.backward.circle") }
                        if ref.mediaType == .movie, let item = model.item {
                            Divider()
                            movieDownloadButton(item)
                        }
                    } label: { Image(systemName: "ellipsis.circle") }
                }
            }
        }
        .task { await reloadDetail() }
        .fullScreenCover(item: $pendingRequest) { req in
            PlayerScreen(request: req)
        }
        .confirmationDialog("Rimuovere \(model.item?.displayTitle ?? "questo titolo") dalla lista?",
                            isPresented: $confirmRemoveFromList, titleVisibility: .visible) {
            Button("Rimuovi", role: .destructive) {
                if let item = model.item {
                    library.toggleWatchlist(item: item, type: ref.mediaType)
                    ToastCenter.shared.show("Rimosso dalla lista")
                }
            }
            Button("Annulla", role: .cancel) {}
        }
        .sheet(isPresented: $showPicker) {
            ProviderPickerSheet(
                candidates: model.providerCandidates,
                currentId: model.providerResolvedId,
                onChoose: { c in Task { await model.confirmProvider(c, library: library); ToastCenter.shared.show("Versione aggiornata") } },
                onRefresh: { Task { await model.refreshProvider(library: library) } }
            )
        }
    }

    // MARK: - Action row (CTA + watchlist)

    private func reloadDetail() async {
        await model.load(
            initialSeason: ref.resumeSeason > 0 ? ref.resumeSeason : nil,
            resolveSeason: { item in library.nextUnwatched(item: item)?.season }
        )
        await model.resolveProvider(library: library)
    }

    @ViewBuilder
    private func actionRow(for item: TmdbItem) -> some View {
        let inList = library.isInWatchlist(item.id, ref.mediaType)

        if model.isUpcoming {
            // Not out yet: show the availability note + bookmark only (web parity).
            Text(upcomingAvailability)
                .font(.subheadline.weight(.semibold)).foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 14).padding(.horizontal, 16)
                .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
            bookmarkButton(item, inList: inList)
        } else {
            releasedActions(for: item, inList: inList)
        }
    }

    @ViewBuilder
    private func releasedActions(for item: TmdbItem, inList: Bool) -> some View {
        let availability = model.providerAvailability
        let ready = availability == .ready

        // Big red primary play button (full width), like the web.
        Button {
            pendingRequest = primaryRequest(for: item)
        } label: {
            HStack(spacing: 8) {
                if availability == .resolving { ProgressView().controlSize(.small).tint(.white) }
                else { Image(systemName: "play.fill") }
                Text(playButtonLabel(for: item))
            }
        }
        .buttonStyle(BrandButtonStyle(kind: ready ? .primary : .secondary))
        .disabled(!ready)

        // "Vai al prossimo" (TV) — jumps past the resume point.
        if ready, let next = nextAfterResume(item) {
            Button {
                pendingRequest = request(for: item, season: next.season, episode: next.episode)
            } label: {
                Text("Vai al prossimo")
            }
            .buttonStyle(BrandButtonStyle(kind: .secondary))
        }

        bookmarkButton(item, inList: inList)

        // Version picker / retry affordances when the auto-match isn't usable.
        Group {
            if showVersionPicker {
                Button {
                    showPicker = true
                } label: {
                    Label(model.providerMatchStatus == .failed ? "Scegli versione" : "Cambia versione",
                          systemImage: "rectangle.stack")
                }
                .buttonStyle(BrandButtonStyle(kind: .secondary, fullWidth: false))
            } else if availability == .unavailable {
                Button {
                    Task { await model.refreshProvider(library: library) }
                } label: {
                    Label("Cerca versioni", systemImage: "arrow.clockwise")
                }
                .buttonStyle(BrandButtonStyle(kind: .secondary, fullWidth: false))
            }
            if let msg = model.providerMessage, !ready {
                Text(msg).font(.footnote).foregroundStyle(.secondary)
            }
        }

        if let trailer = model.trailerURL {
            Button { openURL(trailer) } label: {
                Label("Trailer", systemImage: "play.rectangle")
            }
            .buttonStyle(BrandButtonStyle(kind: .secondary, fullWidth: false))
        }

        if ref.mediaType == .movie, let p = movieResume(item), p.duration > 0 {
            ProgressView(value: Format.percent(position: p.position, duration: p.duration), total: 100)
                .tint(Theme.red)
            HStack {
                Text("\(Format.time(p.position)) / \(Format.time(p.duration))")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Riparti dall'inizio") {
                    library.removeProgress(item.id, .movie, season: 0, episode: 0)
                    ToastCenter.shared.show("Progresso azzerato")
                }
                .font(.caption).buttonStyle(.borderless)
            }
        }
    }

    private func bookmarkButton(_ item: TmdbItem, inList: Bool) -> some View {
        Button {
            if inList {
                confirmRemoveFromList = true
            } else {
                library.toggleWatchlist(item: item, type: ref.mediaType)
                ToastCenter.shared.show("Aggiunto alla lista")
            }
        } label: {
            Image(systemName: inList ? "bookmark.fill" : "bookmark")
        }
        .buttonStyle(BrandButtonStyle(kind: inList ? .primary : .secondary))
        .accessibilityLabel(inList ? "Rimuovi dalla lista" : "Aggiungi alla lista")
    }

    /// "Disponibile: Esce il …" note for upcoming titles (port of upcomingAvailabilityStr).
    private var upcomingAvailability: String {
        var s = model.releaseStatusText.trimmingCharacters(in: .whitespaces)
        if s.hasSuffix(".") { s.removeLast() }
        return s.isEmpty ? "Disponibile dopo l'uscita" : "Disponibile: \(s)"
    }

    // MARK: - Manual mark watched / unwatched

    private func markWatched() {
        guard let item = model.item else { return }
        if ref.mediaType == .movie {
            library.markMovieWatched(tmdbId: item.id, title: item.displayTitle, poster: item.posterPath)
        } else if let last = TVLogic.effectiveLastEpisode(item) {
            library.clearSeriesProgress(item.id)
            library.markWatchedUpTo(tmdbId: item.id, season: last.season, episode: last.episode,
                                    title: item.displayTitle, poster: item.posterPath)
        }
        if library.isInWatchlist(item.id, ref.mediaType) {
            let aired = ref.mediaType == .tv ? TVLogic.airedEpisodesCount(item) : 0
            library.setWatchlistStatus(item.id, ref.mediaType, .done, doneAiredEpisodes: aired)
        }
        ToastCenter.shared.show("Segnato come visto")
    }

    private func markUnwatched() {
        guard let item = model.item else { return }
        if ref.mediaType == .movie {
            library.removeProgress(item.id, .movie, season: 0, episode: 0)
        } else {
            library.clearSeriesProgress(item.id)
        }
        if library.isInWatchlist(item.id, ref.mediaType) {
            library.setWatchlistStatus(item.id, ref.mediaType, .todo)
        }
        ToastCenter.shared.show("Segnato come da vedere")
    }

    private func downloadStatusLabel(_ state: DownloadState) -> String {
        switch state {
        case .queued:      return "In coda per il download"
        case .downloading: return "Download in corso…"
        case .paused:      return "Download in pausa"
        case .completed:   return "Scaricato — disponibile offline"
        case .failed:      return "Download non riuscito"
        }
    }

    @ViewBuilder
    private func movieDownloadButton(_ item: TmdbItem) -> some View {
        if let dl = library.download(item.id, .movie, season: 0, episode: 0) {
            Button(role: .destructive) {
                DownloadManager.shared.delete(dl)
                ToastCenter.shared.show("Download rimosso")
            } label: { Label(dl.state == .completed ? "Elimina scaricato" : "Annulla download", systemImage: "trash") }
        } else {
            Button {
                DownloadManager.shared.enqueue(tmdbId: item.id, type: .movie,
                    title: item.displayTitle, poster: item.posterPath, releaseDate: item.primaryDate)
                ToastCenter.shared.show("Download avviato")
            } label: { Label("Scarica", systemImage: "arrow.down.circle") }
        }
    }

    @ViewBuilder
    private func episodeDownloadButton(_ item: TmdbItem, episode: Int) -> some View {
        if let dl = library.download(item.id, .tv, season: model.selectedSeason, episode: episode) {
            Button(role: .destructive) {
                DownloadManager.shared.delete(dl)
                ToastCenter.shared.show("Download rimosso")
            } label: { Label(dl.state == .completed ? "Elimina scaricato" : "Annulla download", systemImage: "trash") }
        } else {
            Button {
                DownloadManager.shared.enqueue(tmdbId: item.id, type: .tv, season: model.selectedSeason, episode: episode,
                    title: item.displayTitle, poster: item.posterPath, releaseDate: item.primaryDate)
                ToastCenter.shared.show("Download avviato")
            } label: { Label("Scarica episodio", systemImage: "arrow.down.circle") }
        }
    }

    /// Show the picker button when there are candidates to choose from and the
    /// current state isn't a single already-confirmed match.
    private var showVersionPicker: Bool {
        let candidates = model.providerCandidates
        guard !candidates.isEmpty else { return false }
        if candidates.count == 1 && candidates[0].providerTitleId == model.providerResolvedId { return false }
        return true
    }

    private func playButtonLabel(for item: TmdbItem) -> String {
        if model.isUpcoming { return "Non ancora disponibile" }
        switch model.providerAvailability {
        case .resolving: return "Caricamento…"
        case .unavailable: return model.providerMessage ?? "Non disponibile"
        case .needsPicker: return "Scegli la versione"
        case .ready: return primaryLabel(for: item)
        }
    }

    @ViewBuilder
    private func metadata(for item: TmdbItem) -> some View {
        // Order matches the web watch page: tagline → meta → genres → …
        if let tagline = item.tagline, !tagline.isEmpty {
            Text(tagline).font(.callout).italic().foregroundStyle(.secondary)
        }
        if !model.metaLine.isEmpty {
            Text(model.metaLine).font(.subheadline).foregroundStyle(.secondary)
        }
        if !model.genresLine.isEmpty {
            Text(model.genresLine).font(.footnote).foregroundStyle(.secondary)
        }
        // Web suppresses the release-status line for a released-but-unmatched
        // title (unavailable && not upcoming).
        if !model.releaseStatusText.isEmpty,
           !(model.providerAvailability == .unavailable && !model.isUpcoming) {
            Text(model.releaseStatusText).font(.subheadline.weight(.semibold)).foregroundStyle(.white)
        }
        if ref.mediaType == .movie, let dl = library.download(item.id, .movie, season: 0, episode: 0) {
            Label(downloadStatusLabel(dl.state),
                  systemImage: dl.state == .completed ? "arrow.down.circle.fill" : "arrow.down.circle")
                .font(.caption.weight(.semibold))
                .foregroundStyle(dl.state == .completed ? Theme.red : .secondary)
        }
        if let overview = item.overview, !overview.isEmpty {
            Text(overview).font(.body)
        }
        if !model.castLine.isEmpty {
            (Text("Cast: ").bold() + Text(model.castLine)).font(.footnote)
        }
        if !model.tvSummary.isEmpty {
            Text(model.tvSummary).font(.footnote).foregroundStyle(.secondary)
        }
    }

    // MARK: - Episodes (TV)

    @ViewBuilder
    private func episodesSection(for item: TmdbItem) -> some View {
        let progressMap = episodeProgressMap(item)
        let highlight = nextUnwatchedInSeason(item)

        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Episodi", symbol: "play.square.stack.fill")

            VStack(alignment: .leading, spacing: 4) {
                Text("STAGIONE")
                    .font(.caption2.weight(.semibold)).tracking(0.6)
                    .foregroundStyle(.secondary)
                Picker("Stagione", selection: Binding(
                    get: { model.selectedSeason },
                    set: { newValue in Task { await model.changeSeason(newValue) } }
                )) {
                    ForEach(model.seasons, id: \.self) { Text("Stagione \($0)").tag($0) }
                }
                .pickerStyle(.menu)
                .tint(.white)
            }
            .padding(.horizontal)

            if model.loadingEpisodes {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 14) {
                        ForEach(0..<4, id: \.self) { _ in episodeSkeleton }
                    }
                    .padding(.horizontal)
                }
            } else if model.episodes.isEmpty {
                Text("Nessun episodio disponibile per questa stagione.")
                    .font(.subheadline).foregroundStyle(.secondary)
                    .padding(.horizontal)
            } else {
                let disabled = model.providerAvailability == .unavailable && !model.isUpcoming
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: 14) {
                        ForEach(model.episodes) { ep in
                            EpisodeCard(
                                episode: ep,
                                progress: progressMap[ep.episodeNumber],
                                isHighlighted: ep.episodeNumber == highlight,
                                downloadState: library.download(item.id, .tv, season: model.selectedSeason, episode: ep.episodeNumber)?.state
                            )
                            .opacity(disabled ? 0.5 : 1)
                            .onTapGesture {
                                guard !disabled else { return }
                                pendingRequest = request(for: item, season: model.selectedSeason, episode: ep.episodeNumber)
                            }
                            .contextMenu {
                            Button {
                                pendingRequest = request(for: item, season: model.selectedSeason, episode: ep.episodeNumber)
                            } label: { Label("Riproduci", systemImage: "play.fill") }
                            Button {
                                library.markWatchedUpTo(tmdbId: item.id, season: model.selectedSeason,
                                                        episode: ep.episodeNumber, title: item.displayTitle, poster: item.posterPath)
                                ToastCenter.shared.show("Visto fino a S\(model.selectedSeason) E\(ep.episodeNumber)")
                            } label: { Label("Segna visto fino a qui", systemImage: "checkmark.circle") }
                            episodeDownloadButton(item, episode: ep.episodeNumber)
                            if progressMap[ep.episodeNumber] != nil {
                                Button(role: .destructive) {
                                    library.removeProgress(item.id, .tv, season: model.selectedSeason, episode: ep.episodeNumber)
                                    ToastCenter.shared.show("Progresso azzerato")
                                } label: { Label("Azzera progresso", systemImage: "trash") }
                            }
                        }
                    }
                }
                .padding(.horizontal)
            }
            }
        }
    }

    // MARK: - CTA helpers

    private func primaryLabel(for item: TmdbItem) -> String {
        if ref.mediaType == .tv {
            if let next = library.nextUnwatched(item: item) {
                return "Riprendi da S\(next.season) E\(next.episode)"
            }
            return "Guarda"
        }
        if let p = movieResume(item) { return "Riprendi da \(Format.time(p.position))" }
        return "Guarda"
    }

    private func primaryRequest(for item: TmdbItem) -> PlaybackRequest {
        if ref.mediaType == .tv {
            let target = library.nextUnwatched(item: item) ?? (model.seasons.first ?? 1, 1)
            return request(for: item, season: target.season, episode: target.episode)
        }
        return request(for: item, season: 0, episode: 0)
    }

    /// Build a playback request, seeding `startAt` from saved progress when the
    /// title isn't already finished (≥90%).
    private func request(for item: TmdbItem, season: Int, episode: Int) -> PlaybackRequest {
        let p = library.progress(item.id, ref.mediaType, season: season, episode: episode)
        var startAt = 0.0
        if let p, p.position > 10, p.duration <= 0 || p.position < p.duration * TVLogic.watchedThreshold {
            startAt = p.position
        }
        return PlaybackRequest(
            tmdbId: item.id, mediaType: ref.mediaType, title: item.displayTitle, releaseDate: item.primaryDate,
            poster: item.posterPath, backdrop: item.backdropPath,
            season: ref.mediaType == .tv ? season : 0,
            episode: ref.mediaType == .tv ? episode : 0,
            startAt: startAt
        )
    }

    /// Episode after the resume point (for "Vai al prossimo"), or nil.
    private func nextAfterResume(_ item: TmdbItem) -> (season: Int, episode: Int)? {
        guard ref.mediaType == .tv, let next = library.nextUnwatched(item: item) else { return nil }
        return TVLogic.nextEpisode(item, season: next.season, episode: next.episode)
    }

    private func movieResume(_ item: TmdbItem) -> ProgressEntry? {
        guard let p = library.progress(item.id, .movie, season: 0, episode: 0), p.position > 10 else { return nil }
        if p.duration > 0 && p.position >= p.duration * TVLogic.watchedThreshold { return nil }
        return p
    }

    private func episodeProgressMap(_ item: TmdbItem) -> [Int: ProgressEntry] {
        var map: [Int: ProgressEntry] = [:]
        for p in library.seriesProgress(item.id) where p.season == model.selectedSeason && p.position > 5 {
            map[p.episode] = p
        }
        return map
    }

    private func nextUnwatchedInSeason(_ item: TmdbItem) -> Int? {
        guard let next = library.nextUnwatched(item: item), next.season == model.selectedSeason else { return nil }
        return next.episode
    }

    // MARK: - Static sections

    /// Skeleton episode tile shown while a season's episodes load.
    private var episodeSkeleton: some View {
        VStack(alignment: .leading, spacing: 6) {
            SkeletonBox(cornerRadius: 10).frame(width: 220, height: 220 * 9 / 16)
            SkeletonBox(cornerRadius: 6).frame(width: 150, height: 12)
        }
        .frame(width: 220)
    }

    /// Skeleton shown while the TMDB detail loads (title + CTA + meta lines).
    private var detailSkeleton: some View {
        VStack(alignment: .leading, spacing: 12) {
            SkeletonBox(cornerRadius: 8).frame(width: 220, height: 30)
            SkeletonBox(cornerRadius: 14).frame(height: 50)
            SkeletonBox(cornerRadius: 14).frame(height: 46)
            SkeletonBox(cornerRadius: 6).frame(width: 160, height: 14)
            SkeletonBox(cornerRadius: 6).frame(height: 14)
            SkeletonBox(cornerRadius: 6).frame(width: 240, height: 14)
        }
    }

    /// Full-page backdrop pinned to the top, fading into black — the web watch
    /// page look. Fixed to the scroll viewport so content scrolls over it.
    private var backdropBackground: some View {
        ZStack(alignment: .top) {
            Color.black
            if let url = TmdbImage.url(model.item?.backdropPath ?? model.item?.posterPath, .w1280) {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Color.clear
                }
                .frame(maxWidth: .infinity)
                .frame(height: 430)
                .clipped()
                .overlay(
                    LinearGradient(colors: [.black.opacity(0.25), .clear, .black.opacity(0.85), .black],
                                   startPoint: .top, endPoint: .bottom)
                )
            }
        }
        .ignoresSafeArea()
    }

    private var reviewsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Recensioni", symbol: "text.bubble.fill")
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 14) {
                    ForEach(model.reviews) { ReviewCard(review: $0) }
                }
                .padding(.horizontal)
            }
        }
    }

    /// Placeholder shown while reviews/recommendations are still loading.
    private var extrasSkeleton: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Ti potrebbe piacere", symbol: "hand.thumbsup.fill")
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 14) {
                    ForEach(0..<6, id: \.self) { _ in SkeletonCard(width: MediaCard.rowWidth(hSizeClass)) }
                }
                .padding(.horizontal)
            }
        }
    }

    private var recommendationsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Ti potrebbe piacere", symbol: "hand.thumbsup.fill")
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 14) {
                    ForEach(model.recommendations) { item in
                        let type: MediaType = item.mediaType == "tv" ? .tv : (item.mediaType == "movie" ? .movie : ref.mediaType)
                        NavigationLink(value: MediaRef(tmdbId: item.id, mediaType: type)) {
                            MediaCard(card: CardItem(tmdb: item, type: type), width: MediaCard.rowWidth(hSizeClass))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal)
            }
        }
    }
}

/// Episode tile: still with number badge + watched/total time + red progress
/// bar overlaid, red border when it's the next-to-watch, red title when seen.
private struct EpisodeCard: View {
    let episode: TmdbEpisodeDetail
    let progress: ProgressEntry?
    let isHighlighted: Bool
    var downloadState: DownloadState? = nil

    private let w: CGFloat = 220

    private var totalSeconds: Double {
        if let d = progress?.duration, d > 0 { return d }
        return Double((episode.runtime ?? 0) * 60)
    }
    private var watchedSeconds: Double { max(0, progress?.position ?? 0) }
    private var pct: Double { Format.percent(position: watchedSeconds, duration: totalSeconds) }
    private var isWatched: Bool { totalSeconds > 0 && watchedSeconds >= totalSeconds * TVLogic.watchedThreshold }

    private var timeLabel: String? {
        guard totalSeconds > 0 else { return nil }
        let base = "\(Format.time(watchedSeconds))/\(Format.time(totalSeconds))"
        return watchedSeconds <= 0 ? base : "\(base) · \(Int(pct))%"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .bottom) {
                still
                LinearGradient(colors: [.clear, .black.opacity(0.75)], startPoint: .center, endPoint: .bottom)
                VStack(spacing: 4) {
                    HStack(alignment: .bottom) {
                        Text("\(episode.episodeNumber)").font(.title3.bold()).foregroundStyle(.white)
                        Spacer()
                        if let label = timeLabel {
                            Text(label).font(.caption2.monospacedDigit()).foregroundStyle(.white.opacity(0.9))
                        }
                    }
                    if watchedSeconds > 0 { ProgressBar(percent: pct) }
                }
                .padding(8)
            }
            .frame(width: w, height: w * 9 / 16)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(isHighlighted ? Theme.red : .clear, lineWidth: 2.5)
            }
            .overlay(alignment: .topTrailing) {
                if let ds = downloadState {
                    Image(systemName: ds == .completed ? "arrow.down.circle.fill" : "arrow.down.circle")
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(ds == .completed ? Theme.red : .white)
                        .padding(5)
                        .background(.black.opacity(0.4), in: Circle())
                        .padding(6)
                }
            }

            Text(episode.name?.nilIfEmpty ?? "Episodio \(episode.episodeNumber)")
                .font(.caption.bold()).lineLimit(1)
                .foregroundStyle(isWatched ? Theme.red : .white)
            if let overview = episode.overview?.nilIfEmpty {
                Text(overview).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .frame(width: w)
    }

    @ViewBuilder
    private var still: some View {
        if let url = TmdbImage.url(episode.stillPath, .w300) {
            AsyncImage(url: url) { image in
                image.resizable().aspectRatio(contentMode: .fill)
            } placeholder: {
                Rectangle().fill(Color(.secondarySystemBackground))
            }
        } else {
            ZStack {
                Color(.secondarySystemBackground)
                Image(systemName: "tv").foregroundStyle(.secondary)
            }
        }
    }
}

/// Review card — port of the web watch.component review card (author, date,
/// ★ rating, 360-char excerpt, "Leggi su TMDB" link).
private struct ReviewCard: View {
    let review: TmdbReview
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(author).font(.subheadline.bold())
                    if let d = dateText { Text(d).font(.caption2).foregroundStyle(.secondary) }
                }
                Spacer()
                if let r = ratingText {
                    Text("★ \(r)").font(.caption.weight(.semibold)).foregroundStyle(Color(red: 1, green: 0.76, blue: 0.03))
                }
            }
            Text(excerpt).font(.footnote).foregroundStyle(.secondary)
            if let url = review.url.flatMap(URL.init(string:)) {
                Button("Leggi su TMDB") { openURL(url) }
                    .font(.caption.weight(.semibold)).foregroundStyle(Theme.red)
            }
        }
        .padding()
        .frame(width: 300, alignment: .leading)
        .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
    }

    private var author: String {
        review.authorDetails?.name?.nilIfEmpty
            ?? review.authorDetails?.username?.nilIfEmpty
            ?? review.author.nilIfEmpty ?? "Anonimo"
    }

    private var ratingText: String? {
        guard let r = review.authorDetails?.rating else { return nil }
        return String(format: "%.1f", r)
    }

    private var dateText: String? {
        guard let raw = (review.updatedAt ?? review.createdAt), let d = Release.parseDate(raw) else { return nil }
        return Release.longDate(d)
    }

    private var excerpt: String {
        let t = review.content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard t.count > 360 else { return t }
        return String(t.prefix(357)).trimmingCharacters(in: .whitespacesAndNewlines) + "..."
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
