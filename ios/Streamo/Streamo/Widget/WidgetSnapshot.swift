import Foundation

/// Shared between the app and the widget extension via an App Group.
/// The app writes a small snapshot of "Continua a guardare" into the group's
/// UserDefaults; the widget reads it (no SwiftData in the widget process).
///
/// IMPORTANT: this file must be a member of BOTH targets (app + widget).
/// The App Group id below must match the capability you enable in Xcode.
enum WidgetShared {
    /// Change this if you use a different App Group identifier.
    static let appGroup = "group.com.streamo.app"
    private static let continueKey = "continueWatching"

    private static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

    struct ContinueItem: Codable, Identifiable {
        let tmdbId: Int
        let mediaTypeRaw: String      // "movie" | "tv"
        let title: String
        let poster: String?           // TMDB path or absolute URL
        let season: Int
        let episode: Int
        let percent: Double           // 0...100

        var id: String { "\(mediaTypeRaw)-\(tmdbId)" }
        var isTV: Bool { mediaTypeRaw == "tv" }
    }

    static func saveContinue(_ items: [ContinueItem]) {
        guard let defaults, let data = try? JSONEncoder().encode(items) else { return }
        defaults.set(data, forKey: continueKey)
    }

    static func loadContinue() -> [ContinueItem] {
        guard let defaults, let data = defaults.data(forKey: continueKey) else { return [] }
        return (try? JSONDecoder().decode([ContinueItem].self, from: data)) ?? []
    }

    /// TMDB poster sizes (https://developer.themoviedb.org/reference/configuration-details).
    enum PosterSize: String {
        case w185, w342, w500, w780, original
    }

    /// TMDB poster URL for a stored path at the requested size (defaults w342).
    /// Absolute URLs are returned untouched (no resizing possible).
    static func posterURL(_ path: String?, size: PosterSize = .w342) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        if path.hasPrefix("http://") || path.hasPrefix("https://") { return URL(string: path) }
        let normalized = path.hasPrefix("/") ? path : "/\(path)"
        return URL(string: "https://image.tmdb.org/t/p/\(size.rawValue)\(normalized)")
    }

    /// Deep link the widget opens in the app (handled by `.onOpenURL`).
    static func deepLink(_ item: ContinueItem) -> URL? {
        URL(string: "streamo://open?type=\(item.mediaTypeRaw)&id=\(item.tmdbId)&s=\(item.season)&e=\(item.episode)")
    }
}
