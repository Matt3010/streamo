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

/// An offline download of a movie or a single TV episode. The actual media is
/// an HLS `.movpkg` bundle on disk; `localPath` is its path relative to the
/// app home dir (the container path changes across launches, so we never store
/// an absolute URL).
@Model
final class DownloadEntry {
    var tmdbId: Int = 0
    var mediaTypeRaw: String = MediaType.movie.rawValue
    var season: Int = 0
    var episode: Int = 0
    var title: String?
    var poster: String?
    var releaseDate: String?
    var stateRaw: String = DownloadState.queued.rawValue
    /// Last persisted progress (0…1). Live progress while active is held in
    /// DownloadManager; this is the value shown when nothing is running.
    var progress: Double = 0
    var localPath: String?
    var errorMessage: String?
    var addedAt: Date = Date.now

    var mediaType: MediaType { MediaType(rawValue: mediaTypeRaw) ?? .movie }
    var state: DownloadState {
        get { DownloadState(rawValue: stateRaw) ?? .queued }
        set { stateRaw = newValue.rawValue }
    }

    init(tmdbId: Int, mediaType: MediaType, season: Int = 0, episode: Int = 0,
         title: String?, poster: String?, releaseDate: String?,
         state: DownloadState = .queued, progress: Double = 0,
         localPath: String? = nil, addedAt: Date = .now) {
        self.tmdbId = tmdbId
        self.mediaTypeRaw = mediaType.rawValue
        self.season = season
        self.episode = episode
        self.title = title
        self.poster = poster
        self.releaseDate = releaseDate
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
