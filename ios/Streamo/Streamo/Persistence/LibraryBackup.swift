import Foundation
import SwiftData

/// JSON backup of the on-device library. Includes watchlist, progress,
/// history, provider mappings and download *metadata* (the .movpkg files
/// themselves aren't part of the backup — restoring on another device would
/// reference files that don't exist, so completed downloads come back as
/// queued and the user can re-download).
struct LibraryBackupPayload: Codable {
    /// Bumped if the schema ever changes — restore checks this is ≤ current.
    var version: Int = 1
    var exportedAt: Date = .now
    var watchlist: [WatchlistDTO] = []
    var progress: [ProgressDTO] = []
    var history: [HistoryDTO] = []
    var providerMappings: [ProviderMappingDTO] = []
    var downloads: [DownloadDTO] = []
    /// Optional — older backups won't have this field, restore falls back to
    /// the current settings.
    var settings: SettingsDTO?

    struct SettingsDTO: Codable {
        var tmdbApiKey: String
        var autoplayNext: Bool
        var providerLocale: String
        var providerProxyURL: String?
        var providerProxyToken: String?
        /// Optional for backward compatibility: backups made before this field
        /// existed simply leave the proxy master switch at its current value.
        var providerProxyEnabled: Bool?
        var autoDeleteWatchedDownloads: Bool
        /// Optional for backward compatibility (added later).
        var showCardInfo: Bool?
        var streamingMaxHeight: Int?
        var downloadMaxHeight: Int?
        var accentR: Double
        var accentG: Double
        var accentB: Double
    }

    struct WatchlistDTO: Codable {
        var tmdbId: Int
        var mediaType: String
        var title: String?
        var poster: String?
        var status: String
        var addedAt: Date
        var doneAiredEpisodes: Int?
        var lastKnownAiredEpisodes: Int?
        var lastKnownAiredSeason: Int?
    }

    struct ProgressDTO: Codable {
        var tmdbId: Int
        var mediaType: String
        var season: Int
        var episode: Int
        var position: Double
        var duration: Double
        var updatedAt: Date
        var title: String?
        var poster: String?
        var backdrop: String?
        var hiddenFromContinue: Bool
    }

    struct HistoryDTO: Codable {
        var tmdbId: Int
        var mediaType: String
        var season: Int
        var episode: Int
        var watchedAt: Date
        var title: String?
        var poster: String?
    }

    struct ProviderMappingDTO: Codable {
        var tmdbId: Int
        var mediaType: String
        var providerId: Int?
        var providerSlug: String?
        var sourceTitle: String?
        var resolvedTitle: String?
        var matchStatusRaw: String
        var releaseYear: Int?
        var lastCheckedAt: Date
        var candidatesJSON: String?
    }

    struct DownloadDTO: Codable {
        var tmdbId: Int
        var mediaType: String
        var season: Int
        var episode: Int
        var title: String?
        var poster: String?
        var backdrop: String?
        var releaseDate: String?
        var episodeTitle: String?
        var episodeOverview: String?
        var episodeStill: String?
        var episodeRuntime: Int?
        var addedAt: Date
    }
}

@MainActor
extension Library {
    /// Serialize the entire library to JSON. Returns `nil` only if encoding
    /// fails (which shouldn't happen with these plain Codable DTOs).
    func exportBackup() -> Data? {
        var payload = LibraryBackupPayload()
        payload.watchlist = watchlist().map {
            .init(tmdbId: $0.tmdbId, mediaType: $0.mediaTypeRaw, title: $0.title, poster: $0.poster,
                  status: $0.statusRaw, addedAt: $0.addedAt, doneAiredEpisodes: $0.doneAiredEpisodes,
                  lastKnownAiredEpisodes: $0.lastKnownAiredEpisodes,
                  lastKnownAiredSeason: $0.lastKnownAiredSeason)
        }
        payload.progress = (try? context.fetch(FetchDescriptor<ProgressEntry>()))?.map {
            .init(tmdbId: $0.tmdbId, mediaType: $0.mediaTypeRaw, season: $0.season, episode: $0.episode,
                  position: $0.position, duration: $0.duration, updatedAt: $0.updatedAt,
                  title: $0.title, poster: $0.poster, backdrop: $0.backdrop,
                  hiddenFromContinue: $0.hiddenFromContinue)
        } ?? []
        payload.history = history().map {
            .init(tmdbId: $0.tmdbId, mediaType: $0.mediaTypeRaw, season: $0.season, episode: $0.episode,
                  watchedAt: $0.watchedAt, title: $0.title, poster: $0.poster)
        }
        payload.providerMappings = (try? context.fetch(FetchDescriptor<ProviderMapping>()))?.map {
            .init(tmdbId: $0.tmdbId, mediaType: $0.mediaTypeRaw, providerId: $0.providerId,
                  providerSlug: $0.providerSlug, sourceTitle: $0.sourceTitle,
                  resolvedTitle: $0.resolvedTitle, matchStatusRaw: $0.matchStatusRaw,
                  releaseYear: $0.releaseYear, lastCheckedAt: $0.lastCheckedAt,
                  candidatesJSON: $0.candidatesJSON)
        } ?? []
        payload.downloads = downloads().map {
            .init(tmdbId: $0.tmdbId, mediaType: $0.mediaTypeRaw, season: $0.season, episode: $0.episode,
                  title: $0.title, poster: $0.poster, backdrop: $0.backdrop, releaseDate: $0.releaseDate,
                  episodeTitle: $0.episodeTitle, episodeOverview: $0.episodeOverview,
                  episodeStill: $0.episodeStill, episodeRuntime: $0.episodeRuntime, addedAt: $0.addedAt)
        }
        let s = AppSettings.shared
        payload.settings = .init(
            tmdbApiKey: s.tmdbApiKey, autoplayNext: s.autoplayNext, providerLocale: s.providerLocale,
            providerProxyURL: s.providerProxyURL, providerProxyToken: s.providerProxyToken,
            providerProxyEnabled: s.providerProxyEnabled,
            autoDeleteWatchedDownloads: s.autoDeleteWatchedDownloads,
            showCardInfo: s.showCardInfo,
            streamingMaxHeight: s.streamingMaxHeight, downloadMaxHeight: s.downloadMaxHeight,
            accentR: s.accentR, accentG: s.accentG, accentB: s.accentB
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return try? encoder.encode(payload)
    }

    /// Wipe the local library and reinsert everything from `data`. Returns
    /// `false` if the file isn't a valid Streamo backup (nothing is touched
    /// in that case). On-disk download bundles (`.movpkg`) are deleted because
    /// the restored download rows lose their `localPath` references.
    @discardableResult
    func restoreBackup(from data: Data) -> Bool {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let payload = try? decoder.decode(LibraryBackupPayload.self, from: data),
              payload.version <= 1 else { return false }

        // Cancel any active transfers and wipe on-disk downloads first — those
        // files are tied to the *current* library, and the restored rows will
        // have to be re-downloaded.
        for e in downloads() { DownloadManager.shared.delete(e) }

        // Drop existing rows. We keep AppSettings (theme, API key, toggles)
        // because the user might want their visual prefs preserved.
        for e in (try? context.fetch(FetchDescriptor<WatchlistEntry>())) ?? [] { context.delete(e) }
        for e in (try? context.fetch(FetchDescriptor<ProgressEntry>())) ?? [] { context.delete(e) }
        for e in (try? context.fetch(FetchDescriptor<HistoryEntry>())) ?? [] { context.delete(e) }
        for e in (try? context.fetch(FetchDescriptor<ProviderMapping>())) ?? [] { context.delete(e) }
        for e in (try? context.fetch(FetchDescriptor<DownloadEntry>())) ?? [] { context.delete(e) }

        for d in payload.watchlist {
            context.insert(WatchlistEntry(
                tmdbId: d.tmdbId, mediaType: MediaType(rawValue: d.mediaType) ?? .movie,
                title: d.title, poster: d.poster,
                status: WatchlistStatus(rawValue: d.status) ?? .todo,
                addedAt: d.addedAt, doneAiredEpisodes: d.doneAiredEpisodes,
                lastKnownAiredEpisodes: d.lastKnownAiredEpisodes,
                lastKnownAiredSeason: d.lastKnownAiredSeason
            ))
        }
        for d in payload.progress {
            context.insert(ProgressEntry(
                tmdbId: d.tmdbId, mediaType: MediaType(rawValue: d.mediaType) ?? .movie,
                season: d.season, episode: d.episode,
                position: d.position, duration: d.duration, updatedAt: d.updatedAt,
                title: d.title, poster: d.poster, backdrop: d.backdrop,
                hiddenFromContinue: d.hiddenFromContinue
            ))
        }
        for d in payload.history {
            context.insert(HistoryEntry(
                tmdbId: d.tmdbId, mediaType: MediaType(rawValue: d.mediaType) ?? .movie,
                season: d.season, episode: d.episode, watchedAt: d.watchedAt,
                title: d.title, poster: d.poster
            ))
        }
        for d in payload.providerMappings {
            context.insert(ProviderMapping(
                tmdbId: d.tmdbId, mediaType: MediaType(rawValue: d.mediaType) ?? .movie,
                providerId: d.providerId, providerSlug: d.providerSlug,
                sourceTitle: d.sourceTitle, resolvedTitle: d.resolvedTitle,
                matchStatusRaw: d.matchStatusRaw, releaseYear: d.releaseYear,
                lastCheckedAt: d.lastCheckedAt, candidatesJSON: d.candidatesJSON
            ))
        }
        for d in payload.downloads {
            // Restored downloads come back as fresh queue entries — DownloadManager
            // will reattempt the transfer on its serial queue.
            context.insert(DownloadEntry(
                tmdbId: d.tmdbId, mediaType: MediaType(rawValue: d.mediaType) ?? .movie,
                season: d.season, episode: d.episode,
                title: d.title, poster: d.poster, backdrop: d.backdrop, releaseDate: d.releaseDate,
                episodeTitle: d.episodeTitle, episodeOverview: d.episodeOverview,
                episodeStill: d.episodeStill, episodeRuntime: d.episodeRuntime,
                state: .queued, progress: 0, localPath: nil, addedAt: d.addedAt
            ))
        }

        if let snap = payload.settings {
            let s = AppSettings.shared
            s.tmdbApiKey = snap.tmdbApiKey
            s.autoplayNext = snap.autoplayNext
            s.providerLocale = snap.providerLocale
            s.providerProxyURL = snap.providerProxyURL ?? ""
            s.providerProxyToken = snap.providerProxyToken ?? ""
            // Absent in older backups → keep the device's current switch.
            if let proxyEnabled = snap.providerProxyEnabled { s.providerProxyEnabled = proxyEnabled }
            s.autoDeleteWatchedDownloads = snap.autoDeleteWatchedDownloads
            if let showCardInfo = snap.showCardInfo { s.showCardInfo = showCardInfo }
            if let h = snap.streamingMaxHeight { s.streamingMaxHeight = h }
            if let h = snap.downloadMaxHeight { s.downloadMaxHeight = h }
            s.accentR = snap.accentR
            s.accentG = snap.accentG
            s.accentB = snap.accentB
        }

        save()
        return true
    }
}
