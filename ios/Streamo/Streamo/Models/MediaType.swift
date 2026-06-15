import Foundation

/// Mirrors the web app's `MediaType` ('movie' | 'tv'). Raw values match the
/// TMDB / provider wire format so the same strings round-trip through the API
/// and SwiftData without translation.
enum MediaType: String, Codable, Hashable, Sendable {
    case movie
    case tv
}

/// Which catalog a library row belongs to. `tmdb` (StreamingCommunity, the
/// default) keys on a TMDB id; `animeUnity` keys on an AnimeUnity entry id in
/// the same `tmdbId` column. The discriminator keeps the two id spaces from
/// colliding across progress/history/downloads/watchlist. Existing rows decode
/// as `tmdb` via the stored default.
enum ContentSource: String, Codable, Hashable, Sendable {
    case tmdb
    case animeUnity = "au"
}

/// Reason a provider resolve failed — same wire strings as the web app's
/// `ProviderResolveFailureReason`.
enum ProviderResolveFailureReason: String, Codable, Sendable {
    case notFound = "not_found"
    case temporarilyUnavailable = "temporarily_unavailable"
    case unreleased
}

/// Watchlist state per title — mirrors the web `WatchlistStatus`.
enum WatchlistStatus: String, Codable, Hashable, Sendable {
    case todo
    case inProgress = "in_progress"
    case done
}

/// Lifecycle of an offline download.
enum DownloadState: String, Codable, Hashable, Sendable {
    case queued        // waiting its turn in the serial queue
    case downloading   // actively downloading
    case paused        // manually paused by the user
    case completed     // finished, playable offline
    case failed        // errored out
}
