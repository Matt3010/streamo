import Foundation

/// Lightweight navigation token — a TMDB id + media type. Pushed onto a
/// NavigationStack to open the detail/watch page. Optionally carries a
/// resume coordinate so a "Continua a guardare" tap can land on the right
/// season/episode.
struct MediaRef: Hashable, Identifiable {
    let tmdbId: Int
    let mediaType: MediaType
    var resumeSeason: Int = 0
    var resumeEpisode: Int = 0

    var id: String { "\(mediaType.rawValue)-\(tmdbId)" }
}
