import Foundation
import AVFoundation
import CoreMedia
import Observation

/// Drives offline HLS downloads with a strictly SERIAL queue (one active
/// transfer at a time) and pauses the active download while the user is
/// watching something. The media is stored as an `.movpkg` bundle that
/// AVPlayer can play offline; `DownloadEntry` (SwiftData, via `Library`) holds
/// the persisted records, this object owns the live transfer + progress.
@MainActor
@Observable
final class DownloadManager: NSObject {
    static let shared = DownloadManager()

    /// Live progress (0…1) per download key, while a transfer is running.
    private(set) var liveProgress: [String: Double] = [:]
    /// Key of the download currently occupying the single active slot.
    private(set) var activeKey: String?
    /// True while a player is open — the active download is suspended.
    private(set) var playbackActive = false

    @ObservationIgnored private var library: Library?
    @ObservationIgnored private var activeTask: AVAssetDownloadTask?
    @ObservationIgnored private var pendingLocations: [String: String] = [:]
    /// Per-download retry counter for the token-refresh recovery.
    @ObservationIgnored private var retryCount: [String: Int] = [:]
    @ObservationIgnored private let maxRetries = 3

    @ObservationIgnored private lazy var session: AVAssetDownloadURLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: "com.streamo.app.downloads")
        return AVAssetDownloadURLSession(configuration: config,
                                         assetDownloadDelegate: self,
                                         delegateQueue: .main)
    }()

    private override init() { super.init() }

    func key(for entry: DownloadEntry) -> String {
        "\(entry.mediaTypeRaw)-\(entry.tmdbId)-\(entry.season)-\(entry.episode)"
    }

    /// Wire up the store and resume the queue (called once at launch).
    func configure(library: Library) {
        guard self.library == nil else { return }
        self.library = library
        // After a relaunch we don't reattach to background tasks; anything left
        // mid-flight is simply re-queued and restarted from scratch.
        for e in library.downloads() where e.state == .downloading {
            library.setDownloadState(e, .queued, progress: 0)
        }
        startNextIfIdle()
    }

    // MARK: - Public actions

    /// Queue a movie / episode for download and kick the serial queue.
    func enqueue(tmdbId: Int, type: MediaType, season: Int = 0, episode: Int = 0,
                 title: String?, poster: String?, releaseDate: String?) {
        library?.addDownload(tmdbId: tmdbId, type: type, season: season, episode: episode,
                             title: title, poster: poster, releaseDate: releaseDate)
        startNextIfIdle()
    }

    /// Manually pause the active download (halts the queue until resumed).
    func pause(_ entry: DownloadEntry) {
        guard key(for: entry) == activeKey, let task = activeTask else { return }
        task.suspend()
        library?.setDownloadState(entry, .paused)
    }

    /// Resume a manually-paused download.
    func resume(_ entry: DownloadEntry) {
        let k = key(for: entry)
        if k == activeKey, let task = activeTask, entry.state == .paused {
            library?.setDownloadState(entry, .downloading)
            if !playbackActive { task.resume() }
        } else if entry.state == .paused {
            // Lost its task (e.g. after relaunch): re-queue it.
            library?.setDownloadState(entry, .queued)
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
        if let rel = entry.localPath { try? FileManager.default.removeItem(at: Self.fileURL(rel)) }
        liveProgress[k] = nil
        pendingLocations[k] = nil
        library?.removeDownload(entry)
        startNextIfIdle()
    }

    /// Local file URL of a completed download, if playable offline.
    func offlineURL(for entry: DownloadEntry) -> URL? {
        guard entry.state == .completed, let rel = entry.localPath else { return nil }
        let url = Self.fileURL(rel)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    func progress(for entry: DownloadEntry) -> Double {
        liveProgress[key(for: entry)] ?? entry.progress
    }

    // MARK: - Playback coupling (suspend while watching)

    func pauseForPlayback() {
        playbackActive = true
        activeTask?.suspend()
    }

    func resumeAfterPlayback() {
        playbackActive = false
        // Only auto-resume a download that's meant to be running (not one the
        // user paused by hand).
        if let key = activeKey, let task = activeTask,
           let entry = library?.downloads().first(where: { self.key(for: $0) == key }),
           entry.state == .downloading {
            task.resume()
        }
        startNextIfIdle()
    }

    // MARK: - Serial queue

    private func startNextIfIdle() {
        // `activeKey == nil` keeps the slot reserved during the retry backoff
        // window (when activeTask is briefly nil) so we never start two at once.
        guard !playbackActive, activeTask == nil, activeKey == nil, let library,
              let entry = library.firstQueuedDownload() else { return }
        let k = key(for: entry)
        activeKey = k
        retryCount[k] = 0   // fresh download → full retry budget
        library.setDownloadState(entry, .downloading)
        Task { await beginDownload(entry, key: k) }
    }

    private func beginDownload(_ entry: DownloadEntry, key k: String) async {
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
            library?.setDownloadState(entry, .failed, error: resolution.message ?? "Sorgente non disponibile")
            activeKey = nil
            activeTask = nil
            startNextIfIdle()
            return
        }
        let asset = AVURLAsset(url: source.playlistURL,
                               options: ["AVURLAssetHTTPHeaderFieldsKey": source.headers])
        let config = AVAssetDownloadConfiguration(asset: asset, title: entry.title ?? "Streamo")
        let task = session.makeAssetDownloadTask(downloadConfiguration: config)
        task.taskDescription = k
        liveProgress[k] = 0   // reset for this (re)attempt
        activeTask = task
        if playbackActive { task.suspend() } else { task.resume() }
    }

    private func handleCompletion(taskKey: String?, error: Error?) {
        guard let k = taskKey, let library else { return }
        let entry = library.downloads().first { self.key(for: $0) == k }

        if let nsError = error as NSError? {
            // User paused/deleted → leave it; the cancel was deliberate.
            if nsError.code == NSURLErrorCancelled {
                pendingLocations[k] = nil
                if activeKey == k { activeKey = nil; activeTask = nil; startNextIfIdle() }
                return
            }
            // Otherwise it's likely an expired token / transient CDN error:
            // re-resolve the embed (fresh token) and restart, up to maxRetries.
            if let entry, retryCount[k, default: 0] < maxRetries {
                retryCount[k, default: 0] += 1
                pendingLocations[k] = nil
                activeTask = nil   // keep activeKey: this slot is still ours
                Task {
                    try? await Task.sleep(for: .seconds(2))   // small backoff
                    await beginDownload(entry, key: k)
                }
                return
            }
            // Don't surface the raw system error — the UI shows a generic message.
            if let entry { library.setDownloadState(entry, .failed) }
        } else if let entry, let rel = pendingLocations[k] {
            library.completeDownload(entry, localPath: rel)
            liveProgress[k] = 1
            retryCount[k] = nil
        }

        pendingLocations[k] = nil
        if activeKey == k {
            activeKey = nil
            activeTask = nil
            startNextIfIdle()
        }
    }

    static func fileURL(_ relativePath: String) -> URL {
        URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(relativePath)
    }
}

// MARK: - AVAssetDownloadDelegate (delegateQueue is .main → assume isolation)

extension DownloadManager: AVAssetDownloadDelegate {
    nonisolated func urlSession(_ session: URLSession, assetDownloadTask: AVAssetDownloadTask,
                                didFinishDownloadingTo location: URL) {
        let rel = location.relativePath
        let key = assetDownloadTask.taskDescription
        MainActor.assumeIsolated {
            if let key { pendingLocations[key] = rel }
        }
    }

    nonisolated func urlSession(_ session: URLSession, assetDownloadTask: AVAssetDownloadTask,
                                didLoad timeRange: CMTimeRange,
                                totalTimeRangesLoaded loadedTimeRanges: [NSValue],
                                timeRangeExpectedToLoad: CMTimeRange) {
        var loaded = 0.0
        for value in loadedTimeRanges { loaded += value.timeRangeValue.duration.seconds }
        let total = timeRangeExpectedToLoad.duration.seconds
        let pct = total > 0 ? min(1, loaded / total) : 0
        let key = assetDownloadTask.taskDescription
        MainActor.assumeIsolated {
            // Keep progress monotonic: AVAssetDownloadTask's expected-range can
            // shift between callbacks (multiple passes), making the raw value
            // bounce backwards. Only ever move forward.
            if let key, pct > (liveProgress[key] ?? 0) { liveProgress[key] = pct }
        }
    }

    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask,
                                didCompleteWithError error: Error?) {
        let key = task.taskDescription
        MainActor.assumeIsolated {
            handleCompletion(taskKey: key, error: error)
        }
    }
}
