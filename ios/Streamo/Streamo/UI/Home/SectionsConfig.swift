import Foundation

/// A single home row — port of the web `SectionConfig` / `SECTIONS`.
struct HomeSection: Identifiable, Hashable {
    let id: String
    let mediaType: MediaType
    let title: String
    /// SF Symbol name (replaces the FontAwesome icons used on the web).
    let symbol: String
    let endpoint: String
    /// Whether this section renders as its own home row. The trending lists are
    /// still fetched (the hero and the Top 10 read them) but no longer shown as
    /// rows — they'd just duplicate those.
    var showsAsRow: Bool = true
}

enum HomeSections {
    /// Everything fetched on the home screen. Trending stays here so the hero
    /// and Top 10 have data, but is hidden from the row list via `showsAsRow`.
    static let all: [HomeSection] = [
        HomeSection(id: "movie-trending",    mediaType: .movie, title: "Film di tendenza",     symbol: "flame.fill",        endpoint: "/trending/movie/day", showsAsRow: false),
        HomeSection(id: "tv-trending",       mediaType: .tv,    title: "Serie TV di tendenza", symbol: "flame.fill",        endpoint: "/trending/tv/day",    showsAsRow: false),
        HomeSection(id: "movie-now_playing", mediaType: .movie, title: "Al cinema",            symbol: "film.fill",         endpoint: "/movie/now_playing"),
        HomeSection(id: "movie-popular",     mediaType: .movie, title: "Film più visti",       symbol: "eye.fill",          endpoint: "/movie/popular"),
        HomeSection(id: "tv-popular",        mediaType: .tv,    title: "Serie TV più viste",   symbol: "eye.fill",          endpoint: "/tv/popular"),
        HomeSection(id: "movie-upcoming",    mediaType: .movie, title: "Film in arrivo",       symbol: "calendar",          endpoint: "/movie/upcoming"),
        HomeSection(id: "tv-top_rated",      mediaType: .tv,    title: "Serie TV più votate",  symbol: "star.fill",         endpoint: "/tv/top_rated"),
    ]

    /// Sections that actually render as home rows.
    static let rows: [HomeSection] = all.filter(\.showsAsRow)
}
