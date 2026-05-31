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
    /// When set, play this URL instead of resolving the provider — it's a
    /// loopback `http://127.0.0.1:<port>/.../master.m3u8` served by
    /// `LocalHLSServer` from a completed offline download.
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
    /// Latched once the current item reaches the real end, so teardown's final
    /// flush cannot overwrite the 100% save with a slightly-short currentTime.
    private var didReachEnd = false
    /// The request currently playing — updated by autoplay-next so callers
    /// persist progress under the right episode.
    private(set) var activeRequest: PlaybackRequest?
    /// Whether the current online stream is going through the WARP proxy
    /// (`true`) or direct (`false`). `nil` for offline playback (local files,
    /// no provider involved). Drives the WARP / Diretto badge.
    private(set) var viaProxy: Bool?

    // Ordered CDN mirrors of the same vixcloud embed; we fall through them on
    // failure (Server1 → Server2 → …). Not multiple providers — same source.
    private var sources: [VixcloudClient.PlaybackSource] = []
    private var sourceIndex = 0
    /// Resume seek applied once the item reaches .readyToPlay (0 = none).
    private var pendingStartAt: Double = 0

    private func resolve(_ request: PlaybackRequest) async -> ProviderResolver.PlaybackResolution {
        if request.mediaType == .movie {
            return await ProviderResolver.shared.movieSource(tmdbId: request.tmdbId, title: request.title, releaseDate: request.releaseDate, client: .player)
        }
        return await ProviderResolver.shared.episodeSource(tmdbId: request.tmdbId, title: request.title, releaseDate: request.releaseDate, season: request.season, episode: request.episode, client: .player)
    }

    func start(_ request: PlaybackRequest) async {
        self.activeRequest = request
        self.viaProxy = nil
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
        // Mode is known before resolving (it's just the setting), so the loading
        // screen can show the WARP/Diretto badge for the whole resolve duration.
        self.viaProxy = AppSettings.shared.providerProxyActive

        let resolution = await resolve(request)
        self.viaProxy = resolution.viaProxy
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
        self.viaProxy = resolution.viaProxy
        teardownPlayer()
        beginPlayback(request, sources: resolution.sources)
        return true
    }

    private func beginPlayback(_ request: PlaybackRequest, sources: [VixcloudClient.PlaybackSource]) {
        self.sources = sources
        sourceIndex = 0
        pendingStartAt = request.startAt
        didReachEnd = false
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

        let isOffline = request.offlineURL != nil
        // Headers are only useful for remote provider requests (Referer /
        // Origin for vixcloud). The local HLS server doesn't care, and
        // attaching options at all interferes with the loopback codepath.
        // Tag requests as 'player' so the proxy log distinguishes streaming
        // from downloads (AVURLAsset propagates these to every sub-resource).
        var streamHeaders = source.headers
        streamHeaders["X-Streamo-Client"] = "player"
        let options: [String: Any]? = isOffline ? nil : ["AVURLAssetHTTPHeaderFieldsKey": streamHeaders]
        let maxHeight = AppSettings.shared.streamingMaxHeight
        // Through the proxy add query params:
        //  • c=player  → tag sub-resources/AirPlay in the proxy log.
        //  • q=<h>     → make the proxy filter the master to ONLY that variant,
        //                truly forcing the quality (a bitrate/resolution cap
        //                alone lets ABR still pick lower).
        // Forced quality is only applied through the WARP proxy (server-side
        // `q=` master filter), which works for both in-app and AirPlay. Without
        // the proxy we only CAP the resolution (below) — never via a custom
        // URL scheme, which would break AirPlay on a direct stream.
        let streamURL: URL = {
            guard viaProxy == true, !isOffline else { return source.playlistURL }
            var extra = ["c": "player"]
            if maxHeight > 0 { extra["q"] = String(maxHeight) }
            return Self.appendingQuery(extra, on: source.playlistURL)
        }()
        let asset = AVURLAsset(url: streamURL, options: options)
        let item = AVPlayerItem(asset: asset)
        // Resolution cap for direct streaming (and a harmless extra ceiling
        // alongside the proxy filter). Auto = 0 → no cap.
        if !isOffline, maxHeight > 0 {
            item.preferredMaximumResolution = CGSize(width: maxHeight * 16 / 9, height: maxHeight)
        }
        let player = AVPlayer(playerItem: item)
        // AirPlay routes a loopback URL nowhere useful, so leave it off for
        // offline playback. Keep the default `automaticallyWaitsToMinimizeStalling`
        // (true): turning it off makes `play()` no-op until the item is ready,
        // which is what was causing the "tap play/pause a few times to start"
        // behaviour on offline launches.
        player.allowsExternalPlayback = !isOffline
        player.usesExternalPlaybackWhileExternalScreenIsActive = !isOffline
        self.player = player

        installTimeObserver(on: player)
        installEndObserver(for: item)
        installStatusObserver(for: item)
        configureNowPlaying(request, player: player)
        player.play()
        state = .ready
    }

    /// Append the given query items to a proxied stream URL (skipping any name
    /// already present), preserving the existing query.
    private static func appendingQuery(_ extra: [String: String], on url: URL) -> URL {
        guard var comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        var items = comps.queryItems ?? []
        for (name, value) in extra where !items.contains(where: { $0.name == name }) {
            items.append(URLQueryItem(name: name, value: value))
        }
        comps.queryItems = items
        return comps.url ?? url
    }

    private func advanceToNextSource() {
        sourceIndex += 1
        guard sourceIndex < sources.count, let request = activeRequest else {
            // No mirror left. If we were streaming through the WARP proxy, the
            // outage is the likely cause — surface the same message shown when
            // the proxy is already down at open time, instead of a generic one.
            state = .failed(viaProxy == true
                            ? "Proxy non raggiungibile."
                            : "Riproduzione non disponibile")
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
        viaProxy = nil
        state = .idle
    }

    // MARK: - Private

    private func installStatusObserver(for item: AVPlayerItem) {
        statusObserver = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            let status = item.status
            let error = item.error
            Task { @MainActor in self?.handleStatus(status, error: error) }
        }
    }

    private func handleStatus(_ status: AVPlayerItem.Status, error: Error? = nil) {
        switch status {
        case .readyToPlay:
            // Apply the resume seek once, when the item can actually seek.
            if pendingStartAt > 1, let player {
                seekPlayer(player, to: pendingStartAt)
                pendingStartAt = 0
            }
        case .failed:
            let isOffline = activeRequest?.offlineURL != nil
            print("[PlaybackController] AVPlayerItem failed (offline=\(isOffline)): \(String(describing: error))")
            dumpPlayerItemLogs()
            if isOffline, let request = activeRequest {
                // Offline playback has a single source — fall through to a
                // specific user-facing error instead of generic "non disponibile".
                state = .failed(offlineFailureMessage(for: request, error: error))
                return
            }
            // This mirror failed — fall through to the next server.
            advanceToNextSource()
        default:
            break
        }
    }

    /// Dump AVPlayerItem error/access logs to the console. These contain the
    /// exact URLs AVPlayer touched (or tried to touch) and the per-request
    /// status/error codes — the only reliable way to see what's missing from
    /// a `.movpkg` that fails offline.
    private func dumpPlayerItemLogs() {
        guard let item = player?.currentItem else { return }
        if let errorLog = item.errorLog() {
            for event in errorLog.events {
                print("[PlayerItemErrorLog] uri=\(event.uri ?? "?") status=\(event.errorStatusCode) domain=\(event.errorDomain) comment=\(event.errorComment ?? "")")
            }
        }
        if let accessLog = item.accessLog() {
            for event in accessLog.events {
                print("[PlayerItemAccessLog] uri=\(event.uri ?? "?") indicatedBitrate=\(event.indicatedBitrate) numStalls=\(event.numberOfStalls) downloadBytes=\(event.numberOfBytesTransferred)")
            }
        }
    }

    /// Surface the actual cause for offline playback failures. The loopback
    /// server has already accepted the connection if AVPlayer got this far,
    /// so any failure is now a real media-level issue (bad playlist, missing
    /// segment, codec mismatch) and showing the failing URIs makes it easy
    /// to diagnose without dropping to Console.app.
    private func offlineFailureMessage(for request: PlaybackRequest, error: Error?) -> String {
        var lines: [String] = []
        if let ns = error as NSError? { lines.append("\(ns.domain) \(ns.code)") }
        if let events = player?.currentItem?.errorLog()?.events, !events.isEmpty {
            for event in events.prefix(5) {
                let uri = event.uri ?? "(nil)"
                lines.append("ERR: \(trunc(uri))\n  \(event.errorDomain) \(event.errorStatusCode) \(event.errorComment ?? "")")
            }
        }
        if let events = player?.currentItem?.accessLog()?.events, !events.isEmpty {
            for event in events.prefix(3) {
                lines.append("ACC: " + trunc(event.uri ?? "(nil)"))
            }
        }
        if lines.isEmpty {
            lines.append("Riproduzione offline non riuscita.")
        }
        return lines.joined(separator: "\n\n")
    }

    private func trunc(_ s: String, max: Int = 100) -> String {
        s.count > max ? String(s.prefix(max)) + "…" : s
    }

    private func installTimeObserver(on player: AVPlayer) {
        let interval = CMTime(seconds: 5, preferredTimescale: 1)
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.flushProgress() }
        }
    }

    private func flushProgress() {
        guard let player, let item = player.currentItem else { return }
        let duration = item.duration.seconds
        let safeDuration = duration.isFinite ? duration : 0
        let position = didReachEnd && safeDuration > 0 ? safeDuration : player.currentTime().seconds
        guard position.isFinite, position > 0 else { return }
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
        didReachEnd = true
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
        didReachEnd = false
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .moviePlayback)
        try? session.setActive(true)
    }
}
