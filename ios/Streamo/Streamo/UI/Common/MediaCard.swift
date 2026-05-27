import SwiftUI

/// Unified card data — mirrors the web `CardItem`. One shape for every row
/// (TMDB results, search, continue, watchlist, history).
struct CardItem: Identifiable, Equatable {
    let tmdbId: Int
    let mediaType: MediaType
    let title: String
    var poster: String?
    var year: String?
    var rating: String?
    var season: Int?
    var episode: Int?
    var position: Double?
    var duration: Double?
    var status: WatchlistStatus?
    var folderName: String?
    var isUpcoming: Bool = false
    /// Red secondary line ("Mancano 3 episodi").
    var watchStatus: String?
    /// Grey tertiary line (release/resume note).
    var nextReleaseText: String?

    var id: String { "\(mediaType.rawValue)-\(tmdbId)" }

    init(tmdbId: Int, mediaType: MediaType, title: String, poster: String? = nil) {
        self.tmdbId = tmdbId; self.mediaType = mediaType; self.title = title; self.poster = poster
    }

    /// From a TMDB list/detail item (home rows, search, recommendations).
    init(tmdb item: TmdbItem, type: MediaType) {
        self.tmdbId = item.id
        self.mediaType = type
        self.title = item.displayTitle.isEmpty ? "Senza titolo" : item.displayTitle
        self.poster = item.posterPath
        self.year = item.year.map(String.init)
        self.rating = (item.voteAverage ?? 0) > 0 ? String(format: "%.1f", item.voteAverage!) : nil
        self.isUpcoming = Release.isUpcoming(item, type)
        self.nextReleaseText = Release.compactStatus(item, type)
    }

    /// From a continue-watching progress row.
    init(progress p: ProgressEntry) {
        self.tmdbId = p.tmdbId
        self.mediaType = p.mediaType
        self.title = p.title ?? "Senza titolo"
        self.poster = p.poster
        if p.mediaType == .tv { self.season = p.season; self.episode = p.episode }
        self.position = p.position
        self.duration = p.duration
    }

    /// From a resolved "Continua a guardare" row (may be advanced to the next
    /// episode, with progress reset to 0).
    init(continue r: Library.ContinueRow) {
        self.tmdbId = r.tmdbId
        self.mediaType = r.mediaType
        self.title = r.title ?? "Senza titolo"
        self.poster = r.poster
        if r.mediaType == .tv { self.season = r.season; self.episode = r.episode }
        self.position = r.position
        self.duration = r.duration
    }

    /// From a watchlist entry.
    init(watchlist e: WatchlistEntry) {
        self.tmdbId = e.tmdbId
        self.mediaType = e.mediaType
        self.title = e.title ?? "Senza titolo"
        self.poster = e.poster
        self.status = e.status
        self.folderName = e.folderName
    }

    /// From a history entry.
    init(history h: HistoryEntry) {
        self.tmdbId = h.tmdbId
        self.mediaType = h.mediaType
        self.title = h.title ?? "Senza titolo"
        self.poster = h.poster
        if h.mediaType == .tv { self.season = h.season; self.episode = h.episode }
    }
}

/// The single card used across the app — a 2:3 poster with a bottom gradient
/// carrying title + meta + status, an optional progress row, and optional
/// top-right action buttons. Faithful port of the web `CardComponent`.
struct MediaCard: View {
    /// Width for horizontal card rows — larger on regular width (iPad/landscape),
    /// matching the web's wider cards on bigger screens.
    static func rowWidth(_ sizeClass: UserInterfaceSizeClass?) -> CGFloat {
        sizeClass == .regular ? 168 : 124
    }

    var card: CardItem
    var showProgress: Bool = false
    /// When true, computes/shows the red "watch status" line (continue/watchlist).
    var showWatchStatus: Bool = false
    /// Needed to compute the TV watch-status line.
    var library: Library? = nil
    /// Fixed width for horizontal rows; nil → fill the grid cell.
    var width: CGFloat? = nil
    /// When true (history completed TV), the grey line shows "Riprendi da S/E"
    /// instead of a release note — port of the history `resume_text`.
    var wantsResumeHint: Bool = false
    /// Top-right overlay action buttons (built by the container).
    var actions: AnyView? = nil

    @State private var detail: TmdbItem?
    @State private var computedStatus: String?
    @State private var computedReleaseText: String?

    // MARK: Display values (stored value, falling back to fetched detail)

    private var poster: String? { (card.poster?.isEmpty == false ? card.poster : nil) ?? detail?.posterPath }
    private var year: String? { card.year ?? detail?.year.map(String.init) }
    private var rating: String? {
        if let r = card.rating { return r }
        if let v = detail?.voteAverage, v > 0 { return String(format: "%.1f", v) }
        return nil
    }
    private var isUpcoming: Bool {
        if card.isUpcoming { return true }
        guard let detail else { return false }
        return Release.isUpcoming(detail, card.mediaType)
    }
    private var watchStatus: String? { card.watchStatus ?? computedStatus }
    private var releaseText: String? {
        if let nr = card.nextReleaseText { return nr }
        // History resume hint: never fall back to the catalog release note.
        if wantsResumeHint { return computedReleaseText }
        return computedReleaseText ?? detail.flatMap { Release.compactStatus($0, card.mediaType) }
    }

    private var episodeBadge: String? {
        guard card.mediaType == .tv, let s = card.season, let e = card.episode, s > 0, e > 0 else { return nil }
        return "S\(s) E\(e)"
    }
    private var pct: Double {
        guard let p = card.position, let d = card.duration, d > 0 else { return 0 }
        return min(100, max(0, p / d * 100))
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            poster_view
            bottomGradient
            overlayText
            if showProgress, pct > 0 {
                HStack(spacing: 6) {
                    ProgressBar(percent: pct)
                    Text("\(Int(pct.rounded()))%")
                        .font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                        .shadow(color: .black.opacity(0.85), radius: 2)
                }
                .padding(.horizontal, 6).padding(.bottom, 6)
            }
            if let actions {
                actions.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing).padding(6)
            }
        }
        .aspectRatio(2.0/3.0, contentMode: .fit)
        .frame(width: width)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(.white.opacity(0.08)))
        .task { await enrich() }
    }

    // MARK: Pieces

    @ViewBuilder
    private var poster_view: some View {
        Group {
            if let url = TmdbImage.url(poster, .w342) {
                PosterImage(url: url, contentMode: .fill)
            } else {
                ZStack {
                    Color(.secondarySystemBackground)
                    Image(systemName: card.mediaType == .tv ? "tv" : "film").font(.largeTitle).foregroundStyle(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
        .saturation(isUpcoming ? 0.82 : 1)
        .brightness(isUpcoming ? -0.12 : 0)
    }

    private var bottomGradient: some View {
        LinearGradient(colors: [.clear, .black.opacity(0.65), .black.opacity(0.95)],
                       startPoint: .center, endPoint: .bottom)
    }

    private var overlayText: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(card.title)
                .font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                .lineLimit(1).shadow(color: .black.opacity(0.8), radius: 2)
            if episodeBadge != nil || year != nil || rating != nil {
                HStack(spacing: 6) {
                    if let b = episodeBadge { Text(b) }
                    if let y = year { Text(y) }
                    if let r = rating { Text("★ \(r)").foregroundStyle(Color(red: 1, green: 0.76, blue: 0.03)).fontWeight(.semibold) }
                }
                .font(.system(size: 11)).foregroundStyle(.white.opacity(0.85))
                .shadow(color: .black.opacity(0.8), radius: 1)
            }
            if let ws = watchStatus {
                Text(ws).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.red).lineLimit(1)
                    .shadow(color: .black.opacity(0.8), radius: 1)
            }
            if let nr = releaseText {
                Text(nr).font(.system(size: 11, weight: .semibold)).foregroundStyle(Color(white: 0.85)).lineLimit(1)
                    .shadow(color: .black.opacity(0.8), radius: 1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 8)
        .padding(.bottom, showProgress && pct > 0 ? 22 : 10)
    }

    // MARK: Enrichment

    private func enrich() async {
        guard detail == nil else { return }
        // Only hit the network when something's actually missing.
        let needYearRating = card.year == nil || card.rating == nil
        let needPoster = card.poster == nil || card.poster?.isEmpty == true
        let needStatus = showWatchStatus && card.watchStatus == nil
        let needResumeHint = wantsResumeHint && card.mediaType == .tv
        guard needYearRating || needPoster || needStatus || needResumeHint else { return }

        guard let item = try? await TMDBClient.shared.details(id: card.tmdbId, type: card.mediaType) else { return }
        detail = item

        if needStatus {
            if card.mediaType == .movie {
                computedStatus = WatchStatus.movieRemainingText(position: card.position, duration: card.duration)
            } else if let lib = library {
                computedStatus = WatchStatus.tvStatusText(
                    item: item, watchedCount: lib.watchedEpisodeCount(card.tmdbId),
                    doneAiredEpisodes: lib.doneAiredEpisodes(card.tmdbId, card.mediaType),
                    caughtUp: card.status == .done,
                    resume: lib.nextUnwatched(item: item)
                )
            }
        }

        // "Riprendi da S/E": the next episode after the watched one (web resume_text).
        if needResumeHint, let lib = library, let s = card.season, let e = card.episode,
           let next = lib.nextUnwatched(item: item), next.season != s || next.episode != e {
            computedReleaseText = "Riprendi da S\(next.season) E\(next.episode)"
        }
    }
}

/// Thin red progress bar (0–100). Shared by cards.
struct ProgressBar: View {
    let percent: Double

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.28))
                Capsule().fill(Theme.red).frame(width: geo.size.width * percent / 100)
            }
        }
        .frame(height: 4)
    }
}
