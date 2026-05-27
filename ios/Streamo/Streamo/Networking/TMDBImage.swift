import Foundation

/// Builds TMDB image URLs — port of the web `tmdb-image.ts` helper.
/// Images live at https://image.tmdb.org/t/p/<size><path>.
enum TmdbImageSize: String {
    case w92, w300, w342, w500, w780
    case w1280
    case original
}

enum TmdbImage {
    private static let host = "https://image.tmdb.org/t/p"

    /// Returns a URL for a TMDB image path, or nil when the path is empty.
    /// Passes through values that are already absolute URLs.
    static func url(_ path: String?, _ size: TmdbImageSize) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        if path.hasPrefix("http://") || path.hasPrefix("https://") {
            return URL(string: path)
        }
        let normalized = path.hasPrefix("/") ? path : "/\(path)"
        return URL(string: "\(host)/\(size.rawValue)\(normalized)")
    }
}
