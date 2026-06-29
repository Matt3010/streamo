import SwiftUI

/// Unified card data — mirrors the web `CardItem`. One shape for every row
/// (TMDB results, search, continue, watchlist, history).
struct CardItem: Identifiable, Equatable {
    let tmdbId: Int
    let mediaType: MediaType
    let title: String
    var poster: String?
    var backdrop: String?
    var year: String?
    var rating: String?
    var season: Int?
    var episode: Int?
    var position: Double?
    var duration: Double?
    var status: WatchlistStatus?
    var isUpcoming: Bool = false
    /// Red secondary line ("Mancano 3 episodi").
    var watchStatus: String?
    /// Grey tertiary line (release/resume note).
    var nextReleaseText: String?
    /// Absolute artwork URL for non-TMDB sources (AnimeUnity). When set, the
    /// card renders this directly and skips the TMDB image-path resolution and
    /// the detail-enrichment fetch.
    var absolutePoster: URL?
    /// Overrides the computed "S1 E2" episode badge (AnimeUnity uses "Ep. 5",
    /// having no season concept).
    var episodeLabel: String?

    var id: String { "\(mediaType.rawValue)-\(tmdbId)-\(season ?? 0)-\(episode ?? 0)" }

    init(tmdbId: Int, mediaType: MediaType, title: String, poster: String? = nil) {
        self.tmdbId = tmdbId; self.mediaType = mediaType; self.title = title; self.poster = poster
    }

    /// From a TMDB list/detail item (home rows, search, recommendations).
    init(tmdb item: TmdbItem, type: MediaType) {
        self.tmdbId = item.id
        self.mediaType = type
        self.title = item.displayTitle.isEmpty ? UIText.untitled : item.displayTitle
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
        self.title = p.title ?? UIText.untitled
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
        self.title = r.title ?? UIText.untitled
        self.poster = r.poster
        self.backdrop = r.backdrop
        if r.mediaType == .tv { self.season = r.season; self.episode = r.episode }
        self.position = r.position
        self.duration = r.duration
    }

    /// From a watchlist entry.
    init(watchlist e: WatchlistEntry) {
        self.tmdbId = e.tmdbId
        self.mediaType = e.mediaType
        self.title = e.title ?? UIText.untitled
        self.poster = e.poster
        self.status = e.status
    }

    /// From an AnimeUnity catalog entry (native, absolute poster URL, no TMDB).
    init(anime a: AUAnime) {
        self.tmdbId = a.id
        self.mediaType = .tv
        self.title = a.displayTitle
        self.year = a.year.map(String.init)
        self.absolutePoster = URL(string: a.imageurl ?? "")
    }

    /// From an AnimeUnity continue-watching progress row. The stored title is
    /// the player overlay ("Name • Ep. N"); strip the episode suffix so the card
    /// shows the clean name plus its own "Ep. N" badge.
    init(animeProgress p: ProgressEntry) {
        self.tmdbId = p.tmdbId
        self.mediaType = .tv
        self.title = p.animeTitleBase ?? "Anime"
        self.absolutePoster = URL(string: p.poster ?? "")
        self.position = p.position
        self.duration = p.duration
        self.episodeLabel = "Ep. \(p.episode)"
    }

    /// From a history entry.
    init(history h: HistoryEntry) {
        self.tmdbId = h.tmdbId
        self.mediaType = h.mediaType
        self.title = h.title ?? UIText.untitled
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

    /// Wide cards for "Continua a guardare": same approximate height as the
    /// compact poster row, but with a landscape image instead of a cropped poster.
    static func continueWidth(_ sizeClass: UserInterfaceSizeClass?) -> CGFloat {
        sizeClass == .regular ? 300 : 220
    }

    var card: CardItem
    var showProgress: Bool = false
    /// When true, computes/shows the red "watch status" line (continue/watchlist).
    var showWatchStatus: Bool = false
    /// Needed to compute the TV watch-status line.
    var library: Library? = nil
    /// Fixed width for horizontal rows; nil → fill the grid cell.
    var width: CGFloat? = nil
    /// Visual ratio for the card surface. Default is a poster; continue cards
    /// pass a landscape ratio and prefer the backdrop artwork.
    var aspectRatio: CGFloat = 2.0 / 3.0
    /// Force the title/year/rating overlay even when the user turned card info
    /// off in Settings — used by "Continua a guardare", which always shows full
    /// info and progress.
    var alwaysShowInfo: Bool = false
    /// Top-right overlay action buttons (built by the container).
    var actions: AnyView? = nil

    @State private var detail: TmdbItem?

    // MARK: Display values (stored value, falling back to fetched detail)

    private var poster: String? { (card.poster?.isEmpty == false ? card.poster : nil) ?? detail?.posterPath }
    private var backdrop: String? { (card.backdrop?.isEmpty == false ? card.backdrop : nil) ?? detail?.backdropPath }
    private var imagePath: String? {
        aspectRatio > 1 ? (backdrop ?? poster) : poster
    }
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
    /// Red secondary line: the remaining-time of the current movie/episode
    /// ("Mancano 39 min"), derived straight from position/duration — works for
    /// both films and the current TV episode. (The old "Mancano N episodi"
    /// series status was removed.)
    private var watchStatus: String? {
        card.watchStatus ?? WatchStatus.movieRemainingText(position: card.position, duration: card.duration)
    }
    private var releaseText: String? {
        if let nr = card.nextReleaseText { return nr }
        return detail.flatMap { Release.compactStatus($0, card.mediaType) }
    }

    private var episodeBadge: String? {
        if let label = card.episodeLabel { return label }
        guard card.mediaType == .tv, let s = card.season, let e = card.episode, s > 0, e > 0 else { return nil }
        return "S\(s) E\(e)"
    }
    private var pct: Double {
        guard let p = card.position, let d = card.duration else { return 0 }
        return Format.percent(position: p, duration: d)
    }

    var body: some View {
        // Sizing: a fixed-width card (horizontal rows) gets an explicit
        // width × height. A grid card (width == nil) fills its column via a
        // clear aspect-ratio slot, so every cell is exactly the same size —
        // `.aspectRatio(.fit)` alone sized cells inconsistently in the grid.
        Group {
            if let width {
                cardSurface.frame(width: width, height: width / aspectRatio)
            } else {
                Color.clear
                    .aspectRatio(aspectRatio, contentMode: .fit)
                    .frame(maxWidth: .infinity)
                    .overlay { cardSurface }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(.white.opacity(0.08)))
        .task { await enrich() }
    }

    private var cardSurface: some View {
        let showsProgressBar = showProgress && Format.percentValue(pct) > 0
        let hasBottomContent = showsInfo || watchStatus != nil || showsProgressBar
        return ZStack(alignment: .bottom) {
            poster_view
            if hasBottomContent { bottomGradient }
            if hasBottomContent { overlayText }
            if showsProgressBar {
                HStack(spacing: 6) {
                    ProgressBar(percent: pct)
                    Text("\(Format.percentValue(pct))%")
                        .font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                        .shadow(color: .black.opacity(0.85), radius: 2)
                }
                .padding(.horizontal, 6).padding(.bottom, 6)
            }
            if let actions {
                actions.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing).padding(6)
            }
        }
    }

    // MARK: Pieces

    @ViewBuilder
    private var poster_view: some View {
        Group {
            if let url = imageURL {
                PosterImage(url: url, placeholderSystemImage: card.mediaType == .tv ? "tv" : "film", contentMode: .fill)
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

    private var imageURL: URL? {
        if let absolutePoster = card.absolutePoster { return absolutePoster }
        if aspectRatio > 1, backdrop != nil {
            return TmdbImage.backdropURL(backdrop, .w780)
        }
        return TmdbImage.posterURL(imagePath, .w342)
    }

    private var bottomGradient: some View {
        LinearGradient(colors: [.clear, .black.opacity(0.65), .black.opacity(0.95)],
                       startPoint: .center, endPoint: .bottom)
    }

    /// Whether the title/year/rating text is shown. Off when the user disabled
    /// card info in Settings — unless this card forces it (Continua a guardare).
    private var showsInfo: Bool { alwaysShowInfo || AppSettings.shared.showCardInfo }

    private var overlayText: some View {
        VStack(alignment: .leading, spacing: 2) {
            if showsInfo {
                Text(card.title)
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                    .lineLimit(aspectRatio > 1 ? 2 : 1)
                    .truncationMode(.tail)
                    .minimumScaleFactor(0.88)
                    .allowsTightening(true)
                    .shadow(color: .black.opacity(0.8), radius: 2)
                if episodeBadge != nil || year != nil || rating != nil {
                    HStack(spacing: 6) {
                        if let b = episodeBadge { Text(b) }
                        if let y = year { Text(y) }
                        if let r = rating { Text("★ \(r)").foregroundStyle(Color(red: 1, green: 0.76, blue: 0.03)).fontWeight(.semibold) }
                    }
                    .font(.system(size: 11)).foregroundStyle(.white.opacity(0.85))
                    .shadow(color: .black.opacity(0.8), radius: 1)
                }
            }
            // The watch-status ("Mancano N min") is part of the in-progress
            // infographic — kept regardless of the card-info setting.
            if let ws = watchStatus {
                Text(ws).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.red).lineLimit(1)
                    .shadow(color: .black.opacity(0.8), radius: 1)
            }
            if showsInfo, let nr = releaseText {
                Text(nr).font(.system(size: 11, weight: .semibold)).foregroundStyle(Color(white: 0.85)).lineLimit(1)
                    .shadow(color: .black.opacity(0.8), radius: 1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10)
        .padding(.bottom, showProgress && pct > 0 ? 22 : 10)
    }

    // MARK: Enrichment

    private func enrich() async {
        // Non-TMDB cards (AnimeUnity) carry their own artwork and have no TMDB
        // id to look up — never enrich them.
        guard card.absolutePoster == nil else { return }
        guard detail == nil else { return }
        // Only hit the network when something's actually missing.
        let needYearRating = card.year == nil || card.rating == nil
        let needPoster = card.poster == nil || card.poster?.isEmpty == true
        let needBackdrop = aspectRatio > 1 && (card.backdrop == nil || card.backdrop?.isEmpty == true)
        guard needYearRating || needPoster || needBackdrop else { return }

        // Debounce: while flinging through a long grid (Cronologia / La mia
        // lista) a card may appear and disappear in well under this window. Its
        // `.task` is cancelled on disappear, so we never hit the network for
        // cards scrolled past — only ones that actually settle in view enrich.
        try? await Task.sleep(for: .milliseconds(250))
        guard !Task.isCancelled else { return }

        guard let item = try? await TMDBClient.shared.details(id: card.tmdbId, type: card.mediaType) else { return }
        detail = item
    }
}

/// Thin red progress bar (0–100). Shared by cards and the anime episode grid.
/// `rounded` picks a capsule (cards) or a square-cornered rectangle (grid cells
/// pinned to a rectangular edge).
struct ProgressBar: View {
    let percent: Double
    var rounded: Bool = true

    var body: some View {
        if Format.percentValue(percent) > 0 {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    track.fill(.white.opacity(0.28))
                    track.fill(Theme.red).frame(width: geo.size.width * percent / 100)
                }
            }
            .frame(height: 4)
        }
    }

    private var track: AnyShape {
        rounded ? AnyShape(Capsule()) : AnyShape(Rectangle())
    }
}
