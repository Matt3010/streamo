import Foundation
import AVFoundation
import Observation

/// What to play. Carries enough to resolve the provider source and (later)
/// persist progress.
struct PlaybackRequest: Equatable, Identifiable {
    var id: String { "\(source.rawValue)-\(tmdbId)-\(mediaType.rawValue)-\(season)-\(episode)" }
    /// For `.animeUnity` this `tmdbId` actually holds the AnimeUnity entry id
    /// (see `ContentSource`); season is 1 and episode is the AU episode number.
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
    /// Which catalog resolves this request. `.tmdb` → StreamingCommunity (via
    /// TMDB title), `.animeUnity` → AnimeUnity (native ids below).
    var source: ContentSource = .tmdb
    /// AnimeUnity entry slug (for the embed-url Referer). `.animeUnity` only.
    var animeSlug: String? = nil
    /// AnimeUnity episode id passed to `/embed-url/{id}`. `.animeUnity` only.
    var animeEpisodeId: Int? = nil
    /// Absolute artwork URL (AnimeUnity posters are full URLs, not TMDB paths).
    var artworkURLString: String? = nil
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
    /// Non-nil while a seek is in flight; UI reads this as currentTime so the
    /// scrubber holds at the requested spot instead of snapping to the stale
    /// buffering position.
    private var seekTarget: Double?
    private var seekGeneration = 0

    /// A skip affordance the player UI should surface at the current position,
    /// or nil when none applies. Driven by TheIntroDB segments.
    enum SkipPrompt: Equatable {
        case intro(end: Double)
        case credits(start: Double)
    }
    private(set) var skipPrompt: SkipPrompt?
    /// Time span [start, end] in seconds of the active skip segment, so the UI
    /// can fill the button as playback advances through it. Nil when no prompt.
    private(set) var skipSegment: ClosedRange<Double>?
    /// Countdown (seconds) shown before auto-advancing to the next episode, or
    /// nil when no auto-advance is armed.
    private(set) var nextCountdown: Int?
    /// The episode armed for auto-advance, surfaced so "Play now" can fire it.
    private(set) var pendingNextRequest: PlaybackRequest?
    /// Latched once the credits-driven next-episode flow has fired, so the
    /// end-of-stream `onCompleted` fallback never double-advances.
    private(set) var didTriggerNext = false
    /// Fired once when playback first crosses into the credits segment, so the
    /// view can resolve the next episode and arm the countdown.
    var onCreditsReached: (() -> Void)?

    private var segments: IntroSkipClient.Segments?
    private var didFetchSegments = false
    /// Latched once the user taps "Skip intro", so the pill can't flicker back
    /// while the async seek is still in flight (live time briefly lags inside
    /// the intro). Reset per item.
    private var introDismissed = false
    /// Same for "Skip credits": seeking to the end stays inside the credits
    /// region, so without this the pill would re-appear and stick. Reset per item.
    private var creditsDismissed = false
    private var skipBoundaryObserver: Any?
    private var countdownTask: Task<Void, Never>?

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
    /// Last good playback position seen by the time observer. Used to re-seek
    /// when the in-flight item has to be rebuilt after the app was suspended
    /// (the WARP tunnel / loopback connection dies under iOS suspension).
    private var lastPosition: Double = 0
    /// Whether the player was actively playing when the app last backgrounded.
    /// Drives foreground recovery: we only nudge/rebuild a stream the user
    /// hadn't deliberately paused.
    private var wasPlayingBeforeBackground = false
    /// LAN-or-loopback retry state shared by offline playback and on-device
    /// proxy streaming (WARP and/or forced quality). Both serve from
    /// `LocalHLSServer`, so they prefer the device LAN IP (reachable by an
    /// AirPlay receiver) and retry ONCE on loopback (AirPlay off) when the
    /// device can't reach its own LAN address — e.g. Local Network permission
    /// denied / no Wi-Fi. Loopback always works for on-device playback.
    private var usingLAN = false
    private var loopbackForced = false

    private func resolve(_ request: PlaybackRequest) async -> ProviderResolver.PlaybackResolution {
        if request.source == .animeUnity {
            return await ProviderResolver.shared.animeSource(
                animeId: request.tmdbId, slug: request.animeSlug,
                episodeId: request.animeEpisodeId ?? 0, client: .player)
        }
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
        resetSkipState()

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
        resetSkipState()
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
        loopbackForced = false
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

        // For offline playback, prefer a LAN URL (device IP + per-session token)
        // so an AirPlay receiver can fetch the asset over Wi-Fi; the device
        // itself reaches the same URL too. Fall back to the loopback URL with
        // AirPlay off when there's no LAN address or after a LAN load failure
        // (e.g. Local Network permission denied). See the .failed handler.
        usingLAN = false
        let offlinePlaybackURL: URL? = {
            guard isOffline, let loopback = request.offlineURL else { return nil }
            if !loopbackForced,
               let relPath = Self.offlineRelativePath(from: loopback),
               let lanURL = LocalHLSServer.shared.beginAirplaySession(relativePath: relPath) {
                usingLAN = true
                return lanURL
            }
            return loopback
        }()
        // When the source is a LocalHLSServer proxy URL (loopback host), add:
        //  • c=player  → tag sub-resources/AirPlay in the proxy log.
        //  • q=<h>     → make the proxy filter the master to ONLY that variant,
        //                truly FORCING the quality (a bitrate/resolution cap
        //                alone lets ABR still pick lower).
        // ProviderResolver routes through the on-device proxy whenever WARP is
        // on OR a streaming quality is set (so forced quality works in BOTH
        // WARP and Diretto). A bare direct vixcloud source (Diretto + Auto) is
        // played as-is, with only the resolution cap below.
        let streamURL: URL = {
            if isOffline { return offlinePlaybackURL ?? source.playlistURL }
            guard Self.isLocalProxyURL(source.playlistURL) else { return source.playlistURL }
            // The proxy URL targets LocalHLSServer on this device. Prefer the
            // LAN IP so an AirPlay receiver can reach it; loopback (default, or
            // forced after a LAN failure) works on-device but can't AirPlay.
            var base = source.playlistURL
            if !loopbackForced, let lan = Self.lanVariant(of: source.playlistURL) {
                base = lan
                usingLAN = true
            }
            var extra = ["c": "player"]
            if maxHeight > 0 { extra["q"] = String(maxHeight) }
            return Self.appendingQuery(extra, on: base)
        }()
        let asset = AVURLAsset(url: streamURL, options: options)
        let item = AVPlayerItem(asset: asset)
        // Resolution cap for direct streaming (and a harmless extra ceiling
        // alongside the proxy filter). Auto = 0 → no cap.
        if !isOffline, maxHeight > 0 {
            item.preferredMaximumResolution = CGSize(width: maxHeight * 16 / 9, height: maxHeight)
        }
        let player = AVPlayer(playerItem: item)
        // AirPlay hands the *URL* to the receiver, so it only works when that URL
        // is reachable: streaming (always) or offline served over the LAN. A
        // loopback offline URL points the receiver at itself, so keep it off in
        // that fallback case. Keep the default `automaticallyWaitsToMinimizeStalling`
        // (true): turning it off makes `play()` no-op until the item is ready,
        // which is what was causing the "tap play/pause a few times to start"
        // behaviour on offline launches.
        // On-device sources (offline file or local proxy) are AirPlay-reachable
        // only on the LAN variant — loopback points the receiver at itself. A
        // direct vixcloud URL is reachable by the receiver as-is.
        let externalAllowed = (isOffline || Self.isLocalProxyURL(source.playlistURL)) ? usingLAN : true
        player.allowsExternalPlayback = externalAllowed
        player.usesExternalPlaybackWhileExternalScreenIsActive = externalAllowed
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
        // `loopbackForced` is a per-source flag set when THIS source's LAN
        // attempt failed. A fresh mirror deserves its own LAN attempt (AirPlay
        // reach), so clear it — otherwise the first source's LAN failure
        // silently pins every later mirror to loopback-only.
        loopbackForced = false
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
        np.onSkip = { [weak self] delta in self?.skip(by: delta) }
        np.onSeek = { [weak self] pos in self?.seek(to: pos) }
        let subtitle = request.mediaType == .tv ? "Stagione \(request.season) · Episodio \(request.episode)" : nil
        np.setMetadata(title: request.title, subtitle: subtitle, duration: 0,
                       posterURL: TmdbImage.url(request.poster, .w500))
    }

    private func seekPlayer(_ player: AVPlayer, to seconds: Double) {
        // Hold the UI at the requested time until the seek actually lands —
        // otherwise the poll reads the pre-seek (still-buffering) position and
        // the scrubber snaps backwards before jumping to target.
        seekGeneration &+= 1
        let generation = seekGeneration
        seekTarget = seconds
        player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600)) { [weak self] _ in
            Task { @MainActor in
                guard self?.seekGeneration == generation else { return }
                self?.seekTarget = nil
            }
        }
    }

    // MARK: - Skip intro / credits

    /// Clear all skip/next state before a fresh item resolves. NOT called on a
    /// mirror switch (same episode -> state must survive).
    private func resetSkipState() {
        didTriggerNext = false
        didFetchSegments = false
        introDismissed = false
        creditsDismissed = false
        segments = nil
        skipPrompt = nil
        skipSegment = nil
        nextCountdown = nil
        pendingNextRequest = nil
        countdownTask?.cancel()
        countdownTask = nil
    }

    /// Fetch skip segments once for the active item. Guards keep it to a single
    /// network call per item and skip cases TheIntroDB can't serve (offline,
    /// or AnimeUnity whose `tmdbId` is not a real TMDB id).
    private func maybeFetchSkipSegments() {
        guard !didFetchSegments, let req = activeRequest, req.offlineURL == nil,
              req.source == .tmdb, let item = player?.currentItem else { return }
        didFetchSegments = true
        let duration = item.duration.seconds
        let durationMs = duration.isFinite && duration > 0 ? duration * 1000 : nil
        Task { @MainActor in
            let segs = await IntroSkipClient.shared.fetch(
                tmdbId: req.tmdbId, isMovie: req.mediaType == .movie,
                season: req.season, episode: req.episode, durationMs: durationMs)
            // The item may have changed while the request was in flight.
            guard self.activeRequest?.id == req.id else { return }
            self.segments = segs
            self.installSkipBoundaries()
            self.updateSkipPrompt()
        }
    }

    /// Fire `updateSkipPrompt` exactly at the segment edges — precise without
    /// polling. Re-installable: replaces any prior observer (mirror reload).
    private func installSkipBoundaries() {
        if let skipBoundaryObserver, let player {
            player.removeTimeObserver(skipBoundaryObserver)
        }
        skipBoundaryObserver = nil
        guard let player, let s = segments else { return }
        let times = [s.introStart, s.introEnd, s.creditsStart]
            .compactMap { $0 }
            .filter { $0 > 0 }
            .map { NSValue(time: CMTime(seconds: $0, preferredTimescale: 600)) }
        guard !times.isEmpty else { return }
        skipBoundaryObserver = player.addBoundaryTimeObserver(forTimes: times, queue: .main) { [weak self] in
            MainActor.assumeIsolated { self?.updateSkipPrompt() }
        }
    }

    /// Recompute the skip affordance for the current position. Idempotent:
    /// only publishes on an actual change. Latches the credits trigger so the
    /// next-episode flow fires exactly once.
    private func updateSkipPrompt() {
        guard let player, let s = segments else {
            if skipPrompt != nil { skipPrompt = nil }
            return
        }
        let t = currentTime()
        guard t.isFinite else { return }
        let new: SkipPrompt?
        var newSegment: ClosedRange<Double>?
        if !introDismissed, let end = s.introEnd, t >= (s.introStart ?? 0), t < end - 1 {
            new = .intro(end: end)
            let start = s.introStart ?? 0
            newSegment = start...max(end, start + 0.001)
        } else if !creditsDismissed, let start = s.creditsStart, t >= start {
            new = .credits(start: start)
            // Credits run to the end of the media; fill toward the finish.
            let duration = player.currentItem?.duration.seconds ?? 0
            let end = duration.isFinite && duration > start ? duration : start + 1
            newSegment = start...end
            if !didTriggerNext {
                didTriggerNext = true
                onCreditsReached?()
            }
        } else {
            new = nil
            newSegment = nil
        }
        if skipPrompt != new { skipPrompt = new }
        if skipSegment != newSegment { skipSegment = newSegment }
    }

    /// Current playback position in seconds (0 when no player). Lets the fill
    /// animation read live time without an extra observer.
    func currentTime() -> Double {
        if let target = seekTarget { return target }
        let t = player?.currentTime().seconds ?? 0
        return t.isFinite ? t : 0
    }

    /// Item duration in seconds (0 until known / for live). For the scrubber.
    func duration() -> Double {
        let d = player?.currentItem?.duration.seconds ?? 0
        return d.isFinite && d > 0 ? d : 0
    }

    /// Whether playback is currently advancing (drives the play/pause glyph).
    var isPlaying: Bool { (player?.timeControlStatus ?? .paused) != .paused }

    func togglePlayPause() {
        guard let player else { return }
        if player.timeControlStatus == .paused { player.play() } else { player.pause() }
    }

    /// Absolute seek (used by the scrubber).
    func seek(to seconds: Double) {
        guard let player else { return }
        seekPlayer(player, to: max(0, seconds))
    }

    /// Relative seek (±10s buttons), clamped to [0, duration].
    func skip(by delta: Double) {
        guard let player else { return }
        let target = currentTime() + delta
        let dur = duration()
        let clamped = dur > 0 ? min(max(0, target), dur) : max(0, target)
        seekPlayer(player, to: clamped)
    }

    /// Act on the visible skip button. Intro → seek past it. Credits → advance
    /// to the armed next episode (TV) or seek to the end (movie / no next).
    func performSkip() {
        guard let player, let prompt = skipPrompt else { return }
        switch prompt {
        case .intro(let end):
            introDismissed = true   // don't let the pill flicker back during the seek
            seekPlayer(player, to: end)
        case .credits:
            creditsDismissed = true   // seeking to the end stays inside credits — don't let the pill stick
            if pendingNextRequest != nil {
                playNextNow()
            } else if let duration = player.currentItem?.duration.seconds, duration.isFinite, duration > 1 {
                seekPlayer(player, to: duration - 1)
            }
        }
        skipPrompt = nil
        skipSegment = nil
    }

    /// Arm an auto-advance countdown to `request`. Cancellable; counts down to
    /// zero then hands off to `startNext`.
    func armNextEpisode(_ request: PlaybackRequest, seconds: Int = 8) {
        pendingNextRequest = request
        countdownTask?.cancel()
        countdownTask = Task { @MainActor in
            for n in stride(from: seconds, through: 1, by: -1) {
                // Abort if the user scrubbed back out of the credits region —
                // unlatch so re-entering the credits re-arms the countdown.
                guard isPastCreditsStart() else {
                    nextCountdown = nil
                    pendingNextRequest = nil
                    didTriggerNext = false
                    return
                }
                nextCountdown = n
                try? await Task.sleep(for: .seconds(1))
                if Task.isCancelled { return }
            }
            nextCountdown = nil
            await startNext(request)
        }
    }

    /// Whether playback is still at/after the credits start. With no credits
    /// data (end-of-stream fallback path) there's nothing to leave, so true.
    private func isPastCreditsStart() -> Bool {
        guard let start = segments?.creditsStart else { return true }
        return currentTime() >= start
    }

    /// Skip the countdown and advance immediately.
    func playNextNow() {
        guard let request = pendingNextRequest else { return }
        countdownTask?.cancel()
        countdownTask = nil
        nextCountdown = nil
        Task { await startNext(request) }
    }

    /// Dismiss the countdown without advancing. `didTriggerNext` stays latched,
    /// so the end-of-stream fallback won't re-arm it for this episode.
    func cancelNextEpisode() {
        countdownTask?.cancel()
        countdownTask = nil
        nextCountdown = nil
    }

    func teardown() {
        flushProgress()
        countdownTask?.cancel()
        countdownTask = nil
        teardownPlayer()
        // Release the audio session back to the keep-alive's mixable policy
        // (so a still-running background download doesn't stop the user's music).
        BackgroundKeepAlive.shared.setPlayerActive(false)
        NowPlayingCenter.shared.clear()
        // Only resume if streaming actually paused them (offline never did).
        if activeRequest?.offlineURL == nil {
            DownloadManager.shared.resumeAfterPlayback()
        }
        activeRequest = nil
        viaProxy = nil
        state = .idle
    }

    // MARK: - App lifecycle

    /// Record whether the stream was playing as the app backgrounds, so the
    /// foreground recovery only resurrects a stream the user hadn't paused.
    func prepareForBackground() {
        wasPlayingBeforeBackground = (player?.timeControlStatus ?? .paused) != .paused
    }

    /// Recover an online stream when the app returns to the foreground. iOS can
    /// kill the userspace WireGuard sockets (and the loopback connection) during
    /// suspension, leaving the AVPlayer item stalled or `.failed` with no
    /// retry of its own. Re-validate the tunnel first, then either rebuild the
    /// item from the last position (if it died) or nudge it back into play.
    /// Offline playback is local-only and needs none of this.
    func handleForeground() {
        guard activeRequest?.offlineURL == nil, case .ready = state,
              let player, let request = activeRequest else { return }
        Task { @MainActor in
            // The tunnel was flagged stale on background; restart it (or join the
            // restart RootTabView already kicked off) so reissued segment
            // requests have a live egress before we nudge/rebuild the player.
            if AppSettings.shared.providerProxyActive {
                _ = try? await WarpTunnel.shared.start()
            }
            // The player may have been torn down while we awaited the tunnel.
            guard case .ready = state, self.player === player else { return }
            if player.currentItem?.status == .failed {
                // The item gave up during suspension — rebuild the same mirror
                // from where we left off.
                pendingStartAt = lastPosition
                teardownPlayer()
                loadCurrentSource(request: request)
            } else if wasPlayingBeforeBackground {
                // Still alive but paused/stalled by the dead connection. Nudge
                // it: the reissued segment fetch hits the now-live tunnel (and
                // LocalHLSServer's own stale-tunnel retry as a backstop).
                player.play()
            }
        }
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
            // Item is seekable and its duration is known here. Fetch skip
            // segments once; on a mirror reload / foreground rebuild the data
            // is already cached, so just reinstall the boundary observer.
            if segments != nil {
                installSkipBoundaries()
                updateSkipPrompt()
            } else {
                maybeFetchSkipSegments()
            }
        case .failed:
            let isOffline = activeRequest?.offlineURL != nil
            print("[PlaybackController] AVPlayerItem failed (offline=\(isOffline)): \(String(describing: error))")
            dumpPlayerItemLogs()
            // A LAN attempt (offline file or on-device proxy) can fail when the
            // device can't reach its own LAN address (Local Network permission
            // denied / Wi-Fi off). Retry the same source once on loopback with
            // AirPlay disabled before surfacing an error / trying mirrors.
            // teardownPlayer() revokes any AirPlay token.
            if usingLAN, !loopbackForced, let request = activeRequest {
                loopbackForced = true
                teardownPlayer()
                loadCurrentSource(request: request)
                return
            }
            if isOffline {
                // Offline playback has a single source — surface a specific
                // error instead of the generic "non disponibile".
                if let request = activeRequest {
                    state = .failed(offlineFailureMessage(for: request, error: error))
                } else {
                    state = .failed("Riproduzione offline non riuscita.")
                }
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
            MainActor.assumeIsolated {
                self?.flushProgress()
                // Backstop the precise boundary observer: catches manual seeks
                // and any boundary the player skipped over.
                self?.updateSkipPrompt()
            }
        }
    }

    private func flushProgress() {
        guard let player, let item = player.currentItem else { return }
        let duration = item.duration.seconds
        let safeDuration = duration.isFinite ? duration : 0
        let position = didReachEnd && safeDuration > 0 ? safeDuration : player.currentTime().seconds
        guard position.isFinite, position > 0 else { return }
        lastPosition = position
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
        if let skipBoundaryObserver, let player {
            player.removeTimeObserver(skipBoundaryObserver)
        }
        skipBoundaryObserver = nil
        player?.pause()
        player = nil
        seekGeneration &+= 1
        seekTarget = nil
        didReachEnd = false
        // Revoke any AirPlay token so the download stops being LAN-reachable.
        LocalHLSServer.shared.endAirplaySession()
    }

    /// The `Downloads/`-relative path embedded in a `LocalHLSServer` playback
    /// URL (loopback), used to re-issue the same asset on a LAN route. `path`
    /// is percent-decoded; `beginAirplaySession` re-encodes the segments.
    private static func offlineRelativePath(from url: URL) -> String? {
        let path = url.path
        let trimmed = path.hasPrefix("/") ? String(path.dropFirst()) : path
        return trimmed.isEmpty ? nil : trimmed
    }

    /// LAN variant of a loopback proxy URL: same port/path/query (incl. the
    /// `key`), only the host swapped to the device's shareable LAN IP, so an
    /// AirPlay receiver can reach the on-device proxy. Returns nil when offline
    /// / cellular-only (no LAN address → AirPlay is impossible anyway).
    private static func lanVariant(of url: URL) -> URL? {
        guard let host = LANAddress.currentShareableIPv4(),
              var comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        comps.host = host
        return comps.url
    }

    /// Whether a streaming source is a `LocalHLSServer` proxy URL (loopback
    /// host) — i.e. served on-device (WARP egress and/or forced quality) and
    /// thus needing `c=`/`q=` appended + a LAN swap for AirPlay. A direct
    /// vixcloud URL (Diretto + Auto) returns false and plays as-is.
    private static func isLocalProxyURL(_ url: URL) -> Bool {
        url.host == "127.0.0.1"
    }

    private func configureAudioSession() {
        // Claim audio for the player: a non-mixable `.playback` session is what
        // makes PIP auto-start when the app is backgrounded. Tell the keep-alive
        // the player owns audio now, so a concurrent download / LAN keep-alive
        // can't leave a `.mixWithOthers` session that blocks PIP.
        BackgroundKeepAlive.shared.setPlayerActive(true)
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .moviePlayback, options: [])
        try? session.setActive(true)
    }
}
