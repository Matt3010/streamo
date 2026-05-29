import Foundation
import Observation

/// Drives offline HLS downloads with a strictly SERIAL queue (one active
/// transfer at a time) and pauses the active download while the user is
/// watching something. Media is fetched manually via `HLSDownloader` into
/// `Documents/Downloads/<key>/` and served back to AVPlayer through
/// `LocalHLSServer` — we don't use `AVAssetDownloadTask` because AVFoundation
/// refuses to play the resulting `.movpkg` in airplane mode.
/// `DownloadEntry` (SwiftData, via `Library`) holds the persisted records.
@MainActor
@Observable
final class DownloadManager {
    static let shared = DownloadManager()

    /// Live progress (0…1) per download key, while a transfer is running.
    private(set) var liveProgress: [String: Double] = [:]
    /// Key of the download currently occupying the single active slot.
    private(set) var activeKey: String?
    /// True while a player is open — the active download is suspended.
    private(set) var playbackActive = false

    @ObservationIgnored private var library: Library?
    @ObservationIgnored private var activeTask: Task<Void, Never>?
    @ObservationIgnored private var retryCount: [String: Int] = [:]
    @ObservationIgnored private var lastPersistedProgress: [String: Double] = [:]
    @ObservationIgnored private let maxRetries = 3

    private init() {}

    func key(for entry: DownloadEntry) -> String {
        "\(entry.mediaTypeRaw)-\(entry.tmdbId)-\(entry.season)-\(entry.episode)"
    }

    /// Wire up the store and resume the queue (called once at launch).
    func configure(library: Library) {
        guard self.library == nil else { return }
        self.library = library

        // Warm up the loopback HLS server so the first play tap doesn't pay
        // the bind latency.
        Task { _ = try? await LocalHLSServer.shared.ensureRunning() }

        for e in library.downloads() {
            switch e.state {
            case .downloading:
                // We don't reattach to in-flight tasks; HLSDownloader resumes
                // from on-disk segments anyway.
                let resumed = resumedProgress(forKey: key(for: e), fallback: e.progress)
                library.setDownloadState(e, .queued, progress: resumed)
            case .completed:
                // Reset entries left over from the old `.movpkg` implementation:
                // their localPath doesn't point at our new layout, and the file
                // it points to (if it still exists at all) won't play offline.
                let expected = "Documents/Downloads/\(key(for: e))/master.m3u8"
                if e.localPath != expected
                    || !FileManager.default.fileExists(atPath: Self.downloadDirectory(for: key(for: e)).appendingPathComponent("master.m3u8").path) {
                    e.localPath = nil
                    e.localBookmark = nil
                    library.setDownloadState(e, .queued, progress: 0)
                }
            case .queued, .paused, .failed:
                let resumed = resumedProgress(forKey: key(for: e), fallback: e.progress)
                if resumed > e.progress {
                    library.setDownloadState(e, e.state, progress: resumed, error: e.errorMessage)
                }
            }
        }
        refreshCatalog()
        installLibraryObserver()
        installLANProgressBridge()
        startNextIfIdle()
    }

    /// Forward LAN-reported playback positions into `Library.saveProgress` so
    /// "Continua a guardare", history, and the resume marker on the next
    /// page-open match what was watched from the PC.
    private func installLANProgressBridge() {
        LocalHLSServer.shared.setProgressHandler { [weak self] report in
            Task { @MainActor in
                guard let self, let library = self.library else { return }
                let type = MediaType(rawValue: report.mediaType) ?? .movie
                library.saveProgress(
                    tmdbId: report.tmdbId,
                    type: type,
                    season: report.season,
                    episode: report.episode,
                    position: report.position,
                    duration: report.duration,
                    title: report.title,
                    poster: report.poster,
                    backdrop: report.backdrop
                )
                // saveProgress bumps library.version → the observer rearm
                // below picks it up and refreshes the LAN catalog.
            }
        }
    }

    /// Re-arm a one-shot observation on `library.version`: every time the
    /// library mutates (in-app playback, LAN report, manual edits) we push a
    /// fresh catalog snapshot so the next browser play.html load sees the
    /// up-to-date resume position.
    private func installLibraryObserver() {
        guard let library else { return }
        withObservationTracking {
            _ = library.version
        } onChange: { [weak self] in
            Task { @MainActor in
                self?.refreshCatalog()
                self?.installLibraryObserver()
            }
        }
    }

    /// Snapshot the current download list and hand it to `LocalHLSServer` so
    /// the LAN-shared index page reflects the user's library and the browser
    /// player can resume from the saved position.
    func refreshCatalog() {
        guard let library else { return }
        let items = library.downloads().map { entry in
            let p = library.progress(entry.tmdbId, entry.mediaType,
                                     season: entry.season, episode: entry.episode)
            return DownloadEntrySnapshot(
                key: key(for: entry),
                title: entry.title ?? "Senza titolo",
                mediaType: entry.mediaTypeRaw,
                season: entry.season,
                episode: entry.episode,
                episodeTitle: entry.episodeTitle,
                poster: entry.poster,
                backdrop: entry.backdrop,
                isCompleted: entry.state == .completed,
                position: p?.position ?? 0,
                duration: p?.duration ?? 0
            )
        }
        LocalHLSServer.shared.setCatalog(items)
    }

    // MARK: - Public actions

    /// Queue a movie / episode for download and kick the serial queue. Pass
    /// `item` to snapshot the parent TMDB item — that's what lets the detail
    /// screen render fully offline (synopsis, runtime, genres, …).
    func enqueue(tmdbId: Int, type: MediaType, season: Int = 0, episode: Int = 0,
                 title: String?, poster: String?, backdrop: String? = nil, releaseDate: String?,
                 episodeTitle: String? = nil, episodeOverview: String? = nil,
                 episodeStill: String? = nil, episodeRuntime: Int? = nil,
                 item: TmdbItem? = nil) {
        let json = item.flatMap { try? JSONEncoder().encode($0) }
            .flatMap { String(data: $0, encoding: .utf8) }
        library?.addDownload(tmdbId: tmdbId, type: type, season: season, episode: episode,
                             title: title, poster: poster, backdrop: backdrop, releaseDate: releaseDate,
                             episodeTitle: episodeTitle, episodeOverview: episodeOverview,
                             episodeStill: episodeStill, episodeRuntime: episodeRuntime,
                             itemJSON: json)
        prefetchArtwork(poster: poster, backdrop: backdrop, still: episodeStill)
        refreshCatalog()
        startNextIfIdle()
    }

    /// Pull poster/backdrop into the disk image cache so the Downloads page and
    /// any cached detail screens still render in airplane mode.
    private func prefetchArtwork(poster: String?, backdrop: String?, still: String?) {
        let urls: [URL] = [
            TmdbImage.url(poster, .w92),
            TmdbImage.url(poster, .w342),
            TmdbImage.url(backdrop, .w1280),
            TmdbImage.url(still, .w300),
        ].compactMap { $0 }
        guard !urls.isEmpty else { return }
        let cache = ImageCache.disk
        Task.detached(priority: .utility) {
            await withTaskGroup(of: Void.self) { group in
                for url in urls {
                    group.addTask { await cache.prefetch(url) }
                }
            }
        }
    }

    /// Manually pause the active download (halts the queue until resumed).
    /// Partial segment files stay on disk and are skipped on resume.
    func pause(_ entry: DownloadEntry) {
        guard key(for: entry) == activeKey else { return }
        let k = key(for: entry)
        let persisted = liveProgress[k] ?? entry.progress
        activeTask?.cancel()
        activeTask = nil
        activeKey = nil
        liveProgress[k] = persisted
        lastPersistedProgress[k] = persisted
        library?.setDownloadState(entry, .paused, progress: persisted)
    }

    /// Resume a manually-paused download.
    func resume(_ entry: DownloadEntry) {
        guard entry.state == .paused else { return }
        let k = key(for: entry)
        let resumed = resumedProgress(forKey: k, fallback: liveProgress[k] ?? entry.progress)
        liveProgress[k] = resumed
        lastPersistedProgress[k] = resumed
        library?.setDownloadState(entry, .queued, progress: resumed)
        if !startQueuedDownloadIfIdle(key: k) {
            startNextIfIdle()
        }
    }

    /// Cancel + delete a download (and its on-disk media).
    func delete(_ entry: DownloadEntry) {
        let k = key(for: entry)
        if k == activeKey {
            activeTask?.cancel()
            activeTask = nil
            activeKey = nil
        }
        try? FileManager.default.removeItem(at: Self.downloadDirectory(for: k))
        liveProgress[k] = nil
        library?.removeDownload(entry)
        refreshCatalog()
        startNextIfIdle()
    }

    /// Loopback URL of a completed download, or nil if its files are missing
    /// or the local HLS server failed to bind. AVPlayer plays this through
    /// `LocalHLSServer` — which is why offline playback works in airplane
    /// mode (loopback bypasses AVFoundation's network-presence preflight).
    func offlineURL(for entry: DownloadEntry) -> URL? {
        guard entry.state == .completed else { return nil }
        let k = key(for: entry)
        let master = Self.downloadDirectory(for: k).appendingPathComponent("master.m3u8")
        guard FileManager.default.fileExists(atPath: master.path) else { return nil }
        let port = LocalHLSServer.shared.waitForReady()
        guard port != 0 else { return nil }
        return LocalHLSServer.url(port: port, relativePath: "\(k)/master.m3u8")
    }

    func progress(for entry: DownloadEntry) -> Double {
        liveProgress[key(for: entry)] ?? entry.progress
    }

    // MARK: - Playback coupling (suspend while watching)

    func pauseForPlayback() {
        playbackActive = true
        // Stash the running task so it can be restarted from disk after
        // playback ends (resume picks up existing segments).
        if activeTask != nil, let library, let k = activeKey,
           let entry = library.downloads().first(where: { self.key(for: $0) == k }),
           entry.state == .downloading {
            activeTask?.cancel()
            activeTask = nil
            let persisted = liveProgress[k] ?? entry.progress
            liveProgress[k] = persisted
            lastPersistedProgress[k] = persisted
            library.setDownloadState(entry, .queued, progress: persisted)
            activeKey = nil
        }
    }

    func resumeAfterPlayback() {
        playbackActive = false
        startNextIfIdle()
    }

    // MARK: - Serial queue

    private func startNextIfIdle() {
        guard !playbackActive, activeTask == nil, activeKey == nil, let library,
              let entry = library.firstQueuedDownload() else { return }
        start(entry)
    }

    /// Start a specific queued entry immediately when the serial slot is free.
    /// Returns true when this call consumed the idle slot.
    @discardableResult
    private func startEntryIfIdle(_ entry: DownloadEntry) -> Bool {
        guard !playbackActive, activeTask == nil, activeKey == nil else { return false }
        guard entry.state == .queued else { return false }
        start(entry)
        return true
    }

    /// Like `startEntryIfIdle`, but re-fetches the entry from SwiftData by key
    /// so resume actions don't depend on the UI holding a perfectly-fresh
    /// model instance after the queued-state write.
    @discardableResult
    private func startQueuedDownloadIfIdle(key k: String) -> Bool {
        guard !playbackActive, activeTask == nil, activeKey == nil,
              let library,
              let entry = library.downloads().first(where: { key(for: $0) == k }),
              entry.state == .queued else { return false }
        start(entry)
        return true
    }

    private func start(_ entry: DownloadEntry) {
        let k = key(for: entry)
        activeKey = k
        retryCount[k] = 0
        let initial = max(liveProgress[k] ?? 0, entry.progress)
        liveProgress[k] = initial
        lastPersistedProgress[k] = entry.progress
        library?.setDownloadState(entry, .downloading, progress: initial)
        activeTask = Task { [weak self] in
            await self?.runDownload(key: k)
        }
    }

    /// Run the download for the entry identified by `k`. Looks the entry up
    /// from the library on every callback rather than capturing it — SwiftData
    /// `@Model` instances aren't `Sendable` so they can't cross the boundary
    /// into the `HLSDownloader`'s `@Sendable` progress closure.
    private func runDownload(key k: String) async {
        guard let library, let entry = library.downloads().first(where: { key(for: $0) == k }) else {
            cleanupActive(key: k)
            return
        }

        let resolution: ProviderResolver.PlaybackResolution
        if entry.mediaType == .movie {
            resolution = await ProviderResolver.shared.movieSource(
                tmdbId: entry.tmdbId, title: entry.title ?? "", releaseDate: entry.releaseDate)
        } else {
            resolution = await ProviderResolver.shared.episodeSource(
                tmdbId: entry.tmdbId, title: entry.title ?? "", releaseDate: entry.releaseDate,
                season: entry.season, episode: entry.episode)
        }
        guard let source = resolution.sources.first else {
            fail(key: k, error: resolution.message ?? "Sorgente non disponibile")
            return
        }

        let outputDir = Self.downloadDirectory(for: k)
        do {
            try await HLSDownloader.download(masterURL: source.playlistURL,
                                             headers: source.headers,
                                             outputDirectory: outputDir,
                                             progress: { [weak self] frac in
                Task { @MainActor in
                    guard let self else { return }
                    let prev = self.liveProgress[k] ?? 0
                    let next = max(frac, prev)
                    if next > prev { self.liveProgress[k] = next }
                    self.persistLiveProgressIfNeeded(key: k, value: next)
                }
            })
        } catch is CancellationError {
            // Pause / playback / delete cancelled this download. State is
            // already updated by the caller; nothing else to do.
            return
        } catch {
            // Transient errors: bounded retry with fresh source resolution.
            let next = retryCount[k, default: 0] + 1
            retryCount[k] = next
            if next <= maxRetries {
                activeTask = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(2))
                    await self?.runDownload(key: k)
                }
                return
            }
            fail(key: k, error: nil)
            return
        }

        // Success — re-fetch the entry (it might have been mutated meanwhile).
        if let entry = library.downloads().first(where: { key(for: $0) == k }) {
            liveProgress[k] = 1
            library.completeDownload(entry, localPath: "Documents/Downloads/\(k)/master.m3u8")
        }
        retryCount[k] = nil
        lastPersistedProgress[k] = nil
        activeKey = nil
        activeTask = nil
        refreshCatalog()
        startNextIfIdle()
    }

    private func fail(key k: String, error: String?) {
        if let library, let entry = library.downloads().first(where: { key(for: $0) == k }) {
            library.setDownloadState(entry, .failed, error: error)
        }
        cleanupActive(key: k)
    }

    private func cleanupActive(key k: String) {
        liveProgress[k] = nil
        retryCount[k] = nil
        lastPersistedProgress[k] = nil
        activeKey = nil
        activeTask = nil
        startNextIfIdle()
    }

    /// Persist live progress sparingly so relaunch/resume has an accurate base
    /// without turning every segment completion into a SwiftData write.
    private func persistLiveProgressIfNeeded(key k: String, value: Double) {
        guard let library,
              let entry = library.downloads().first(where: { key(for: $0) == k }),
              entry.state == .downloading else { return }
        let previous = lastPersistedProgress[k] ?? entry.progress
        guard value >= previous + 0.02 || value >= 0.995 else { return }
        lastPersistedProgress[k] = value
        library.setDownloadState(entry, .downloading, progress: value)
    }

    /// Best-effort progress rebuild from already-downloaded files on disk.
    /// This keeps the UI honest after pause/resume or app relaunch, even
    /// though we don't persist every live tick into SwiftData.
    private func resumedProgress(forKey key: String, fallback: Double) -> Double {
        let dir = Self.downloadDirectory(for: key)
        guard FileManager.default.fileExists(atPath: dir.path) else { return fallback }

        let fm = FileManager.default
        let directoryContents = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)
        let playlists = directoryContents?.filter { $0.pathExtension.lowercased() == "m3u8" } ?? []
        guard !playlists.isEmpty else { return fallback }

        let trackPlaylists = playlists.filter { $0.lastPathComponent != "master.m3u8" }
        let sources = trackPlaylists.isEmpty
            ? playlists.filter { $0.lastPathComponent == "master.m3u8" }
            : trackPlaylists
        guard !sources.isEmpty else { return fallback }

        var totalResources = 0
        var completedResources = 0
        for playlist in sources {
            guard let text = try? String(contentsOf: playlist, encoding: .utf8) else {
                continue
            }
            let resources = HLSPlaylistParser.resourceNames(in: text)
            totalResources += resources.count
            completedResources += resources.reduce(0) { partial, name in
                partial + (fm.fileExists(atPath: dir.appendingPathComponent(name).path) ? 1 : 0)
            }
        }
        guard totalResources > 0 else { return fallback }
        let fraction = Double(completedResources) / Double(totalResources)
        return max(fallback, min(1, fraction))
    }

    // MARK: - Paths

    /// Per-download folder under `Documents/Downloads/<key>/`.
    nonisolated static func downloadDirectory(for key: String) -> URL {
        LocalHLSServer.shared.documentsRoot.appendingPathComponent(key, isDirectory: true)
    }
}
