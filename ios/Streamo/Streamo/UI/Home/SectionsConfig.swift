import Foundation

/// A single home row — port of the web `SectionConfig` / `SECTIONS`.
struct HomeSection: Identifiable, Hashable {
    let id: String
    let mediaType: MediaType
    let title: String
    /// SF Symbol name (replaces the FontAwesome icons used on the web).
    let symbol: String
    let endpoint: String
}

enum HomeSections {
    /// Same flat, interleaved Film/Serie list as the web home.
    static let all: [HomeSection] = [
        HomeSection(id: "movie-trending",    mediaType: .movie, title: "Film di tendenza",     symbol: "flame.fill",        endpoint: "/trending/movie/day"),
        HomeSection(id: "tv-trending",       mediaType: .tv,    title: "Serie TV di tendenza", symbol: "flame.fill",        endpoint: "/trending/tv/day"),
        HomeSection(id: "movie-now_playing", mediaType: .movie, title: "Al cinema",            symbol: "film.fill",         endpoint: "/movie/now_playing"),
        HomeSection(id: "tv-on_the_air",     mediaType: .tv,    title: "Serie TV in onda",     symbol: "tv.fill",           endpoint: "/tv/on_the_air"),
        HomeSection(id: "movie-popular",     mediaType: .movie, title: "Film più visti",       symbol: "eye.fill",          endpoint: "/movie/popular"),
        HomeSection(id: "tv-popular",        mediaType: .tv,    title: "Serie TV più viste",   symbol: "eye.fill",          endpoint: "/tv/popular"),
        HomeSection(id: "movie-upcoming",    mediaType: .movie, title: "Film in arrivo",       symbol: "calendar",          endpoint: "/movie/upcoming"),
        HomeSection(id: "tv-top_rated",      mediaType: .tv,    title: "Serie TV più votate",  symbol: "star.fill",         endpoint: "/tv/top_rated"),
        HomeSection(id: "tv-airing_today",   mediaType: .tv,    title: "Oggi in TV",           symbol: "antenna.radiowaves.left.and.right", endpoint: "/tv/airing_today"),
    ]
}
