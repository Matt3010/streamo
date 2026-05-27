import Foundation
import AVFoundation
import Observation

/// What to play. Carries enough to resolve the provider source and (later)
/// persist progress.
struct PlaybackRequest: Equatable, Identifiable {
    var id: String { "\(tmdbId)-\(mediaType.rawValue)-\(season)-\(episode)" }
    let tmdbId: Int
    let mediaType: MediaType
    let title: String
    let releaseDate: String?
    var poster: String? = nil
    var backdrop: String? = nil
    var season: Int = 0
    var episode: Int = 0
    /// Resume position in seconds (0 = start from the beginning).
    var startAt: Double = 0
    /// When set, play this local `.movpkg` instead of resolving the provider
    /// (offline playback of a completed download).
    var offlineURL: URL? = nil
}

/// Resolves a provider source and drives an AVPlayer. Headers (Referer/Origin)
/// are injected via AVURLAsset so vixcloud / vix-content.net accept the manifest
/// + segment + AES-key requests that nginx used to spoof.
@MainActor
@Observable
final class PlaybackController {
    enum State: Equatable {
        case idle
        case resolving
        case ready
        case failed(String)
    }

    private(set) var state: State = .idle
    private(set) var player: AVPlayer?

    /// Called ~every few seconds and on teardown with (position, duration).
    /// The watch page hooks progress persistence here.
    var onProgress: ((Double, Double) -> Void)?
    /// Called once when the item plays to the end — native replacement for the
    /// old embed-bridge.js completion event. Drives mark-complete / autoplay.
    var onCompleted: (() -> Void)?

    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var statusObserver: NSKeyValueObservation?
    /// The request currently playing — updated by autoplay-next so callers
    /// persist progress under the right episode.
    private(set) var activeRequest: PlaybackRequest?

    // Ordered CDN mirrors of the same vixcloud embed; we fall through them on
    // failure (Server1 → Server2 → …). Not multiple providers — same source.
    private var sources: [VixcloudClient.PlaybackSource] = []
    private var sourceIndex = 0
    /// Resume seek applied once the item reaches .readyToPlay (0 = none).
    private var pendingStartAt: Double = 0

    private func resolve(_ request: PlaybackRequest) async -> ProviderResolver.PlaybackResolution {
        if request.mediaType == .movie {
            return await ProviderResolver.shared.movieSource(tmdbId: request.tmdbId, title: request.title, releaseDate: request.releaseDate)
        }
        return await ProviderResolver.shared.episodeSource(tmdbId: request.tmdbId, title: request.title, releaseDate: request.releaseDate, season: request.season, episode: request.episode)
    }

    func start(_ request: PlaybackRequest) async {
        self.activeRequest = request
        state = .resolving
        teardownPlayer()

        // Offline download: play the local bundle directly, no provider resolve.
        // Offline playback uses no network, so downloads keep running.
        if let offline = request.offlineURL {
            beginPlayback(request, sources: [VixcloudClient.PlaybackSource(playlistURL: offline, headers: [:])])
            return
        }

        // Streaming uses the network/provider, so pause downloads while it plays.
        DownloadManager.shared.pauseForPlayback()

        let resolution = await resolve(request)
        guard !resolution.sources.isEmpty else {
            state = .failed(resolution.message ?? "Titolo non disponibile")
            return
        }
        beginPlayback(request, sources: resolution.sources)
    }

    /// Autoplay variant: resolve the next request first and only switch if it
    /// actually has sources, so a finished episode never hands off to an error
    /// screen (web parity — autoplay aborts on an unavailable next episode).
    /// Returns whether playback advanced.
    @discardableResult
    func startNext(_ request: PlaybackRequest) async -> Bool {
        let resolution = await resolve(request)
        guard !resolution.sources.isEmpty else { return false }
        self.activeRequest = request
        teardownPlayer()
        beginPlayback(request, sources: resolution.sources)
        return true
    }

    private func beginPlayback(_ request: PlaybackRequest, sources: [VixcloudClient.PlaybackSource]) {
        self.sources = sources
        sourceIndex = 0
        pendingStartAt = request.startAt
        loadCurrentSource(request: request)
    }

    /// Build the player for `sources[sourceIndex]`. On failure the status
    /// observer advances to the next mirror.
    private func loadCurrentSource(request: PlaybackRequest) {
        guard sourceIndex < sources.count else {
            state = .failed("Riproduzione non disponibile")
            return
        }
        let source = sources[sourceIndex]
        configureAudioSession()

        // AVURLAssetHTTPHeaderFieldsKey is undocumented but the standard way to
        // attach headers to every request AVPlayer makes for this asset.
        let options: [String: Any] = ["AVURLAssetHTTPHeaderFieldsKey": source.headers]
        let asset = AVURLAsset(url: source.playlistURL, options: options)
        let item = AVPlayerItem(asset: asset)
        let player = AVPlayer(playerItem: item)
        player.allowsExternalPlayback = true       // AirPlay
        player.usesExternalPlaybackWhileExternalScreenIsActive = true
        self.player = player

        installTimeObserver(on: player)
        installEndObserver(for: item)
        installStatusObserver(for: item)
        configureNowPlaying(request, player: player)
        player.play()
        state = .ready
    }

    private func advanceToNextSource() {
        sourceIndex += 1
        guard sourceIndex < sources.count, let request = activeRequest else {
            state = .failed("Riproduzione non disponibile")
            return
        }
        teardownPlayer()
        loadCurrentSource(request: request)
    }

    private func configureNowPlaying(_ request: PlaybackRequest, player: AVPlayer) {
        let np = NowPlayingCenter.shared
        np.configureCommands()
        np.onPlay = { [weak player] in player?.play() }
        np.onPause = { [weak player] in player?.pause() }
        np.onSkip = { [weak self, weak player] delta in
            guard let player else { return }
            let target = max(0, player.currentTime().seconds + delta)
            self?.seekPlayer(player, to: target)
        }
        np.onSeek = { [weak self, weak player] pos in
            guard let player else { return }
            self?.seekPlayer(player, to: pos)
        }
        let subtitle = request.mediaType == .tv ? "Stagione \(request.season) · Episodio \(request.episode)" : nil
        np.setMetadata(title: request.title, subtitle: subtitle, duration: 0,
                       posterURL: TmdbImage.url(request.poster, .w500))
    }

    private func seekPlayer(_ player: AVPlayer, to seconds: Double) {
        player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600))
    }

    func teardown() {
        flushProgress()
        teardownPlayer()
        NowPlayingCenter.shared.clear()
        // Only resume if streaming actually paused them (offline never did).
        if activeRequest?.offlineURL == nil {
            DownloadManager.shared.resumeAfterPlayback()
        }
        activeRequest = nil
        state = .idle
    }

    // MARK: - Private

    private func installStatusObserver(for item: AVPlayerItem) {
        statusObserver = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            let status = item.status
            Task { @MainActor in self?.handleStatus(status) }
        }
    }

    private func handleStatus(_ status: AVPlayerItem.Status) {
        switch status {
        case .readyToPlay:
            // Apply the resume seek once, when the item can actually seek.
            if pendingStartAt > 1, let player {
                seekPlayer(player, to: pendingStartAt)
                pendingStartAt = 0
            }
        case .failed:
            // This mirror failed — fall through to the next server.
            advanceToNextSource()
        default:
            break
        }
    }

    private func installTimeObserver(on player: AVPlayer) {
        let interval = CMTime(seconds: 5, preferredTimescale: 1)
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.flushProgress() }
        }
    }

    private func flushProgress() {
        guard let player, let item = player.currentItem else { return }
        let position = player.currentTime().seconds
        let duration = item.duration.seconds
        guard position.isFinite, position > 0 else { return }
        let safeDuration = duration.isFinite ? duration : 0
        NowPlayingCenter.shared.update(position: position, duration: safeDuration, rate: player.rate)
        onProgress?(position, safeDuration)
    }

    private func installEndObserver(for item: AVPlayerItem) {
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.handleEnded() }
        }
    }

    private func handleEnded() {
        if let item = player?.currentItem {
            let duration = item.duration.seconds
            if duration.isFinite, duration > 0 { onProgress?(duration, duration) }
        }
        onCompleted?()
    }

    private func teardownPlayer() {
        if let timeObserver, let player {
            player.removeTimeObserver(timeObserver)
        }
        timeObserver = nil
        if let endObserver {
            NotificationCenter.default.removeObserver(endObserver)
        }
        endObserver = nil
        statusObserver?.invalidate()
        statusObserver = nil
        player?.pause()
        player = nil
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .moviePlayback)
        try? session.setActive(true)
    }
}
