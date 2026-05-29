import Foundation
import SwiftData

// On-device SwiftData models — replace the Postgres tables from the web app.
// Single user, so no user_id columns. mediaType is stored as its raw String
// (iOS 17 has no #Unique macro; stores enforce identity via fetch-by-key).
//
// Every stored property has an inline default value: this is required for the
// optional CloudKit sync (SwiftData + CloudKit forbids non-optional attributes
// without a default) and is harmless for the local-only store.

@Model
final class WatchlistEntry {
    var tmdbId: Int = 0
    var mediaTypeRaw: String = MediaType.movie.rawValue
    var title: String?
    var poster: String?
    var statusRaw: String = WatchlistStatus.todo.rawValue
    var addedAt: Date = Date.now
    /// For TV rows manually marked done: aired-episode count at mark time, so
    /// new releases can flip the row back to todo without faking progress.
    var doneAiredEpisodes: Int?
    /// Optional folder this entry belongs to (nil = ungrouped).
    var folderName: String?
    /// Last aired-episode count we notified about — drives new-episode alerts.
    var lastKnownAiredEpisodes: Int?
    /// Last aired *season* number we notified about — distinguishes a new
    /// season alert from a plain new-episode one (web `isNewSeason`).
    var lastKnownAiredSeason: Int?

    var mediaType: MediaType { MediaType(rawValue: mediaTypeRaw) ?? .movie }
    var status: WatchlistStatus {
        get { WatchlistStatus(rawValue: statusRaw) ?? .todo }
        set { statusRaw = newValue.rawValue }
    }

    init(tmdbId: Int, mediaType: MediaType, title: String?, poster: String?,
         status: WatchlistStatus = .todo, addedAt: Date = .now, doneAiredEpisodes: Int? = nil,
         folderName: String? = nil, lastKnownAiredEpisodes: Int? = nil, lastKnownAiredSeason: Int? = nil) {
        self.tmdbId = tmdbId
        self.mediaTypeRaw = mediaType.rawValue
        self.title = title
        self.poster = poster
        self.statusRaw = status.rawValue
        self.addedAt = addedAt
        self.doneAiredEpisodes = doneAiredEpisodes
        self.folderName = folderName
        self.lastKnownAiredEpisodes = lastKnownAiredEpisodes
        self.lastKnownAiredSeason = lastKnownAiredSeason
    }
}

@Model
final class ProgressEntry {
    var tmdbId: Int = 0
    var mediaTypeRaw: String = MediaType.movie.rawValue
    var season: Int = 0
    var episode: Int = 0
    var position: Double = 0
    var duration: Double = 0
    var updatedAt: Date = Date.now
    var title: String?
    var poster: String?
    var backdrop: String?
    /// Hidden from the "Continua a guardare" row (without deleting progress).
    var hiddenFromContinue: Bool = false

    var mediaType: MediaType { MediaType(rawValue: mediaTypeRaw) ?? .movie }

    init(tmdbId: Int, mediaType: MediaType, season: Int, episode: Int,
         position: Double, duration: Double, updatedAt: Date = .now,
         title: String?, poster: String?, backdrop: String?, hiddenFromContinue: Bool = false) {
        self.tmdbId = tmdbId
        self.mediaTypeRaw = mediaType.rawValue
        self.season = season
        self.episode = episode
        self.position = position
        self.duration = duration
        self.updatedAt = updatedAt
        self.title = title
        self.poster = poster
        self.backdrop = backdrop
        self.hiddenFromContinue = hiddenFromContinue
    }
}

@Model
final class HistoryEntry {
    var tmdbId: Int = 0
    var mediaTypeRaw: String = MediaType.movie.rawValue
    var season: Int = 0
    var episode: Int = 0
    var watchedAt: Date = Date.now
    var title: String?
    var poster: String?

    var mediaType: MediaType { MediaType(rawValue: mediaTypeRaw) ?? .movie }

    init(tmdbId: Int, mediaType: MediaType, season: Int, episode: Int,
         watchedAt: Date = .now, title: String?, poster: String?) {
        self.tmdbId = tmdbId
        self.mediaTypeRaw = mediaType.rawValue
        self.season = season
        self.episode = episode
        self.watchedAt = watchedAt
        self.title = title
        self.poster = poster
    }
}

/// An offline download of a movie or a single TV episode. The media is a
/// plain directory of HLS files at `Documents/Downloads/<key>/`, served back
/// to AVPlayer by `LocalHLSServer`. `localPath` is a sentinel pointing at the
/// rewritten master playlist inside that folder; `localBookmark` is a leftover
/// field from the previous `.movpkg`-based implementation, kept to avoid a
/// SwiftData migration but no longer written.
@Model
final class DownloadEntry {
    var tmdbId: Int = 0
    var mediaTypeRaw: String = MediaType.movie.rawValue
    var season: Int = 0
    var episode: Int = 0
    var title: String?
    var poster: String?
    var backdrop: String?
    var releaseDate: String?
    var episodeTitle: String?
    var episodeOverview: String?
    var episodeStill: String?
    var episodeRuntime: Int?
    var stateRaw: String = DownloadState.queued.rawValue
    /// Last persisted progress (0…1). Live progress while active is held in
    /// DownloadManager; this is the value shown when nothing is running.
    var progress: Double = 0
    var localPath: String?
    var localBookmark: Data?
    var errorMessage: String?
    /// Whether the media was fetched through the WARP proxy (`true`) or pulled
    /// directly from the provider/CDN (`false`). `nil` for entries downloaded
    /// before this was tracked. Recorded at resolve time in `DownloadManager`.
    var viaProxy: Bool?
    /// When `viaProxy` is true, whether the proxy's WARP egress was actually up
    /// at resolve time (`true`) or down (`false`). `nil` when direct or unknown.
    /// Lets the badge warn (red) when the proxy is used but not actually warping.
    var warpHealthy: Bool?
    var addedAt: Date = Date.now
    /// Snapshot of the parent `TmdbItem` (series for TV, movie for movies)
    /// at download time, serialized as JSON. Lets the detail screen render
    /// fully offline — synopsis, runtime, genres, vote, cast — without
    /// hitting TMDB when there's no network.
    var itemJSON: String?

    var mediaType: MediaType { MediaType(rawValue: mediaTypeRaw) ?? .movie }
    var state: DownloadState {
        get { DownloadState(rawValue: stateRaw) ?? .queued }
        set { stateRaw = newValue.rawValue }
    }

    init(tmdbId: Int, mediaType: MediaType, season: Int = 0, episode: Int = 0,
         title: String?, poster: String?, backdrop: String? = nil, releaseDate: String?,
         episodeTitle: String? = nil, episodeOverview: String? = nil,
         episodeStill: String? = nil, episodeRuntime: Int? = nil,
         state: DownloadState = .queued, progress: Double = 0,
         localPath: String? = nil, addedAt: Date = .now) {
        self.tmdbId = tmdbId
        self.mediaTypeRaw = mediaType.rawValue
        self.season = season
        self.episode = episode
        self.title = title
        self.poster = poster
        self.backdrop = backdrop
        self.releaseDate = releaseDate
        self.episodeTitle = episodeTitle
        self.episodeOverview = episodeOverview
        self.episodeStill = episodeStill
        self.episodeRuntime = episodeRuntime
        self.stateRaw = state.rawValue
        self.progress = progress
        self.localPath = localPath
        self.addedAt = addedAt
    }
}

/// Persisted streamingcommunity ↔ TMDB title mapping — port of the
/// `provider_title_map` table. `candidatesJSON` stores the encoded
/// [ProviderCandidate] list for the picker.
@Model
final class ProviderMapping {
    var tmdbId: Int = 0
    var mediaTypeRaw: String = MediaType.movie.rawValue
    var providerId: Int?
    var providerSlug: String?
    var sourceTitle: String?
    var resolvedTitle: String?
    var matchStatusRaw: String = "failed"
    var releaseYear: Int?
    var lastCheckedAt: Date = Date.now
    var candidatesJSON: String?

    var mediaType: MediaType { MediaType(rawValue: mediaTypeRaw) ?? .movie }

    init(tmdbId: Int, mediaType: MediaType, providerId: Int? = nil,
         providerSlug: String? = nil, sourceTitle: String? = nil,
         resolvedTitle: String? = nil, matchStatusRaw: String = "failed",
         releaseYear: Int? = nil, lastCheckedAt: Date = .now,
         candidatesJSON: String? = nil) {
        self.tmdbId = tmdbId
        self.mediaTypeRaw = mediaType.rawValue
        self.providerId = providerId
        self.providerSlug = providerSlug
        self.sourceTitle = sourceTitle
        self.resolvedTitle = resolvedTitle
        self.matchStatusRaw = matchStatusRaw
        self.releaseYear = releaseYear
        self.lastCheckedAt = lastCheckedAt
        self.candidatesJSON = candidatesJSON
    }
}
