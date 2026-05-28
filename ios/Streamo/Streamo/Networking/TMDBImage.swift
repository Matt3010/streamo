import Foundation

/// Builds TMDB image URLs — port of the web `tmdb-image.ts` helper.
/// Images live at https://image.tmdb.org/t/p/<size><path>.
enum TmdbImageSize: String {
    case w92, w154, w185, w300, w342, w500, w780
    case w1280
    case original
}

enum TmdbPosterSize: String {
    case w92, w154, w185, w342, w500, w780, original
}

enum TmdbBackdropSize: String {
    case w300, w780, w1280, original
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

    static func posterURL(_ path: String?, _ size: TmdbPosterSize) -> URL? {
        url(path, size.rawValue)
    }

    static func backdropURL(_ path: String?, _ size: TmdbBackdropSize) -> URL? {
        url(path, size.rawValue)
    }

    private static func url(_ path: String?, _ size: String) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        if path.hasPrefix("http://") || path.hasPrefix("https://") {
            return URL(string: path)
        }
        let normalized = path.hasPrefix("/") ? path : "/\(path)"
        return URL(string: "\(host)/\(size)\(normalized)")
    }
}
