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
    /// True only while AVPlayer is waiting for enough media after playback was
    /// requested. The UI keeps controls visible and surfaces a spinner in this
    /// state instead of treating buffering as active playback.
    private(set) var isBuffering = false
    private var playbackRequested = false
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
    /// Set when resolving the next episode fails for a retryable reason (TMDB,
    /// AnimeUnity or local-server startup). The credits latch stays closed to
    /// avoid retrying every five-second playback tick, while the literal end of
    /// the current item is allowed one final attempt.
    private var nextEpisodeResolutionFailed = false
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
    /// Manual "Play now" launches its own task. Keep it registered so an
    /// explicit new start or teardown can cancel it before it begins/commits.
    private var manualNextTask: Task<Void, Never>?
    private var manualNextGeneration: UInt = 0
    /// Identifies the currently registered countdown task. Incrementing it
    /// invalidates cleanup from an older cancelled task, so that task can never
    /// clear the handle of a newer countdown.
    private var countdownGeneration: UInt = 0

    /// Provider resolution currently in flight. A new playback request or a
    /// teardown cancels it and advances `playbackGeneration`, so a late result
    /// can never recreate or replace a player that is no longer current.
    private var resolutionTask: Task<ProviderResolver.PlaybackResolution, Never>?
    private var playbackGeneration: UInt = 0

    /// Serializes next-episode hand-offs. Credits, end-of-stream fallback and
    /// "Play now" can all target the same episode within a very small window;
    /// only the first trigger is allowed to resolve and commit that transition.
    private var nextTransitionRequestID: String?
    private var nextTransitionGeneration: UInt = 0

    /// Called ~every few seconds and on teardown with (position, duration).
    /// The watch page hooks progress persistence here.
    var onProgress: ((Double, Double) -> Void)?
    /// Called once when the item plays to the end — native replacement for the
    /// old embed-bridge.js completion event. Drives mark-complete / autoplay.
    var onCompleted: (() -> Void)?

    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var statusObserver: NSKeyValueObservation?
    private var timeControlObserver: NSKeyValueObservation?
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
    /// Live-proxy lease used by the currently committed stream. A newly resolved
    /// episode gets its own token; the old lease is revoked only after the old
    /// player has been stopped, so AirPlay cannot receive transient 401s.
    private var activeLiveProxyToken: String?
    /// Tracks whether this controller actually paused the download queue. This
    /// makes error/teardown cleanup idempotent and avoids resuming it twice.
    private var downloadsPausedForPlayback = false

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
        cancelManualNextTask()
        invalidateNextTransition()
        let generation = beginPlaybackOperation()

        // A fresh explicit start supersedes any existing item immediately.
        flushProgress()
        teardownPlayer()
        replaceLiveProxyToken(with: nil)
        NowPlayingCenter.shared.clear()

        self.activeRequest = request
        self.viaProxy = nil
        state = .resolving
        resetSkipState()
        configureDownloadMode(for: request)

        // Offline download: play the local bundle directly, no provider resolve.
        if let offline = request.offlineURL {
            guard isCurrentPlaybackOperation(generation) else { return }
            beginPlayback(request,
                          sources: [VixcloudClient.PlaybackSource(playlistURL: offline, headers: [:])],
                          liveProxyToken: nil)
            return
        }

        // Mode is known before resolving (it's just the setting), so the loading
        // screen can show the WARP/Diretto badge for the whole resolve duration.
        self.viaProxy = AppSettings.shared.providerProxyActive

        guard let resolution = await resolveForPlayback(request, generation: generation) else { return }
        self.viaProxy = resolution.viaProxy
        guard !resolution.sources.isEmpty else {
            if let token = resolution.liveProxyToken { LocalHLSServer.shared.revokeLiveProxyToken(token) }
            failPlayback(resolution.message ?? "Titolo non disponibile")
            return
        }
        beginPlayback(request, sources: resolution.sources, liveProxyToken: resolution.liveProxyToken)
    }

    /// Autoplay variant: resolve the next request first and only switch if it
    /// actually has sources, so a finished episode never hands off to an error
    /// screen (web parity — autoplay aborts on an unavailable next episode).
    /// Returns whether playback advanced.
    @discardableResult
    func startNext(_ request: PlaybackRequest) async -> Bool {
        await startNext(request, cancelCountdown: true)
    }

    /// Internal autoplay entry point. The countdown calls this with
    /// `cancelCountdown: false`; otherwise resetting the per-item state would
    /// cancel the task that is currently executing this transition.
    @discardableResult
    private func startNext(_ request: PlaybackRequest, cancelCountdown: Bool) async -> Bool {
        guard activeRequest != nil, !Task.isCancelled else { return false }
        guard let transitionGeneration = beginNextTransition(for: request) else {
            return false
        }
        defer { finishNextTransition(requestID: request.id, generation: transitionGeneration) }

        let generation = beginPlaybackOperation()

        // A manual/immediate advance must dismiss any visible countdown now, but
        // keep the current item's completion latch and skip state intact until the
        // next stream has actually resolved.
        if cancelCountdown {
            cancelCountdownTask()
            nextCountdown = nil
            pendingNextRequest = nil
        }

        if let offline = request.offlineURL {
            guard isCurrentPlaybackOperation(generation) else { return false }
            commitNextPlayback(
                request,
                sources: [VixcloudClient.PlaybackSource(playlistURL: offline, headers: [:])],
                viaProxy: nil,
                liveProxyToken: nil
            )
            return true
        }

        guard let resolution = await resolveForPlayback(request, generation: generation),
              !resolution.sources.isEmpty else { return false }

        commitNextPlayback(request,
                           sources: resolution.sources,
                           viaProxy: resolution.viaProxy,
                           liveProxyToken: resolution.liveProxyToken)
        return true
    }

    /// Atomically commit a resolved next episode. The old request remains active
    /// until its final progress snapshot has been persisted; only then do we
    /// reset per-item state, stop the old player and rotate proxy leases.
    private func commitNextPlayback(
        _ request: PlaybackRequest,
        sources: [VixcloudClient.PlaybackSource],
        viaProxy: Bool?,
        liveProxyToken: String?
    ) {
        flushProgress()
        resetSkipState(cancelCountdown: false)
        teardownPlayer()
        self.activeRequest = request
        self.viaProxy = viaProxy
        configureDownloadMode(for: request)
        beginPlayback(request, sources: sources, liveProxyToken: liveProxyToken)
    }

    /// Acquire the single next-episode transition slot. All entry points run on
    /// the MainActor, so checking and setting the slot is atomic. A duplicate or
    /// conflicting trigger is ignored instead of cancelling/restarting the
    /// provider request already in flight.
    private func beginNextTransition(for request: PlaybackRequest) -> UInt? {
        guard nextTransitionRequestID == nil else { return nil }
        nextTransitionGeneration &+= 1
        nextTransitionRequestID = request.id
        return nextTransitionGeneration
    }

    private func finishNextTransition(requestID: String, generation: UInt) {
        guard nextTransitionGeneration == generation,
              nextTransitionRequestID == requestID else { return }
        nextTransitionRequestID = nil
    }

    /// A normal `start` or teardown supersedes any in-flight next-episode
    /// hand-off. Advancing the generation keeps cleanup from that old task from
    /// releasing a newer transition slot. Provider work is invalidated separately
    /// by `beginPlaybackOperation` / `invalidatePlaybackOperations`.
    private func invalidateNextTransition() {
        nextTransitionGeneration &+= 1
        nextTransitionRequestID = nil
    }

    private var isNextTransitionInProgress: Bool {
        nextTransitionRequestID != nil
    }

    /// Start resolving the next episode for the current item. This clears only
    /// the prior retryable-failure marker; the credits latch remains closed until
    /// a new player item is committed.
    func beginNextEpisodeResolution(for requestID: String) {
        guard activeRequest?.id == requestID else { return }
        nextEpisodeResolutionFailed = false
    }

    /// Record a retryable next-episode resolution failure and report whether the
    /// end callback already ran while the request was suspended. MainActor
    /// serialization makes the two possible orderings deterministic:
    ///
    /// - failure first: `needsNextEpisodeEndFallback` is true when the later end
    ///   callback runs;
    /// - end first: the caller receives `true` and performs one final attempt.
    @discardableResult
    func recordNextEpisodeResolutionFailure(for requestID: String) -> Bool {
        guard activeRequest?.id == requestID else { return false }
        nextEpisodeResolutionFailed = true
        return didReachEnd
    }

    /// End-of-stream should resolve the next episode when credits never fired or
    /// when a retryable lookup/startup failed. The separate failure marker avoids
    /// opening `didTriggerNext` and hammering services on every periodic update.
    var needsNextEpisodeEndFallback: Bool {
        !didTriggerNext || nextEpisodeResolutionFailed
    }

    /// Start a new logical playback operation and invalidate any provider
    /// resolution belonging to an older request. The generation is checked
    /// again after every suspension point before mutating player state.
    private func beginPlaybackOperation() -> UInt {
        playbackGeneration &+= 1
        resolutionTask?.cancel()
        resolutionTask = nil
        return playbackGeneration
    }

    /// Invalidate all asynchronous playback work without starting a replacement.
    /// Used by teardown so late provider responses become harmless no-ops.
    private func invalidatePlaybackOperations() {
        playbackGeneration &+= 1
        resolutionTask?.cancel()
        resolutionTask = nil
    }

    private func isCurrentPlaybackOperation(_ generation: UInt) -> Bool {
        playbackGeneration == generation && !Task.isCancelled
    }

    /// Resolve through a registered cancellable task. Cancellation is useful for
    /// cooperative URLSession work; the generation check is the hard guarantee
    /// for providers that finish despite cancellation.
    private func resolveForPlayback(
        _ request: PlaybackRequest,
        generation: UInt
    ) async -> ProviderResolver.PlaybackResolution? {
        let task = Task { await resolve(request) }
        resolutionTask = task
        let resolution = await withTaskCancellationHandler {
            await task.value
        } onCancel: {
            task.cancel()
        }

        let isCurrent = playbackGeneration == generation
        if isCurrent { resolutionTask = nil }
        guard isCurrent, !Task.isCancelled else {
            if let token = resolution.liveProxyToken {
                LocalHLSServer.shared.revokeLiveProxyToken(token)
            }
            return nil
        }
        return resolution
    }

    private func beginPlayback(
        _ request: PlaybackRequest,
        sources: [VixcloudClient.PlaybackSource],
        liveProxyToken: String?
    ) {
        replaceLiveProxyToken(with: liveProxyToken)
        self.sources = sources
        sourceIndex = 0
        pendingStartAt = request.startAt
        lastPosition = request.startAt
        didReachEnd = false
        loopbackForced = false
        state = .resolving
        loadCurrentSource(request: request)
    }

    /// Build the player for `sources[sourceIndex]`. On failure the status
    /// observer advances to the next mirror.
    private func loadCurrentSource(request: PlaybackRequest) {
        guard sourceIndex < sources.count else {
            failPlayback("Riproduzione non disponibile")
            return
        }
        state = .resolving
        let source = sources[sourceIndex]
        configureAudioSession()

        let route = PlaybackRouteBuilder.route(
            for: request,
            source: source,
            loopbackForced: loopbackForced
        )
        usingLAN = route.usingLAN

        let asset = AVURLAsset(url: route.url, options: route.assetOptions)
        let item = AVPlayerItem(asset: asset)
        // Resolution cap for direct streaming (and a harmless extra ceiling
        // alongside the proxy filter). Auto = 0 → no cap.
        if !route.isOffline, route.maxHeight > 0 {
            item.preferredMaximumResolution = CGSize(width: route.maxHeight * 16 / 9, height: route.maxHeight)
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
        player.allowsExternalPlayback = route.allowsExternalPlayback
        player.usesExternalPlaybackWhileExternalScreenIsActive = route.allowsExternalPlayback
        self.player = player

        installTimeObserver(on: player)
        installEndObserver(for: item)
        installStatusObserver(for: item)
        installTimeControlObserver(for: player)
        configureNowPlaying(request, player: player)
        play()
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
            failPlayback(viaProxy == true
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
        np.onPlay = { [weak self] in self?.play() }
        np.onPause = { [weak self] in self?.pause() }
        np.onToggle = { [weak self] in self?.togglePlayPause() }
        np.onSkip = { [weak self] delta in self?.skip(by: delta) }
        np.onSeek = { [weak self] pos in self?.seek(to: pos) }
        let subtitle = request.mediaType == .tv ? "Stagione \(request.season) · Episodio \(request.episode)" : nil
        let posterURL = request.source == .animeUnity
            ? request.artworkURLString.flatMap(URL.init(string:))
            : TmdbImage.url(request.poster, .w500)
        np.setMetadata(title: request.title, subtitle: subtitle, duration: 0,
                       posterURL: posterURL)
    }

    private func seekPlayer(
        _ player: AVPlayer,
        to seconds: Double,
        clearsPendingStartOnCompletion: Bool = false
    ) {
        seekGeneration &+= 1
        let generation = seekGeneration
        let target = max(0, seconds)
        seekTarget = target
        lastPosition = target
        didReachEnd = false
        updateNowPlaying(position: target)
        player.seek(to: CMTime(seconds: target, preferredTimescale: 600)) { [weak self, weak player] _ in
            Task { @MainActor in
                guard let self, let player,
                      self.player === player,
                      self.seekGeneration == generation else { return }
                self.seekTarget = nil
                let landed = player.currentTime().seconds
                if landed.isFinite { self.lastPosition = landed }
                if clearsPendingStartOnCompletion,
                   abs(self.pendingStartAt - target) < 0.5 {
                    self.pendingStartAt = 0
                }
                self.updateNowPlaying()
            }
        }
    }

    // MARK: - Skip intro / credits

    /// Clear all skip/next state when committing a fresh item. NOT called on a
    /// mirror switch (same episode -> state must survive).
    private func resetSkipState(cancelCountdown: Bool = true) {
        didTriggerNext = false
        nextEpisodeResolutionFailed = false
        didFetchSegments = false
        introDismissed = false
        creditsDismissed = false
        segments = nil
        skipPrompt = nil
        skipSegment = nil
        nextCountdown = nil
        pendingNextRequest = nil
        if cancelCountdown {
            cancelCountdownTask()
        }
    }

    /// Cancel the registered countdown and invalidate cleanup from that task.
    /// The generation guard prevents an older cancelled task from clearing a
    /// newer countdown that may already have been armed.
    private func cancelCountdownTask() {
        countdownGeneration &+= 1
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

    /// Effective playback state for controls. A buffering player remains active
    /// (`.waitingToPlayAtSpecifiedRate`), while an external/system pause is not
    /// mistaken for a user-visible playing state merely because play was requested.
    var isPlaying: Bool {
        guard playbackRequested, let player else { return false }
        return player.timeControlStatus != .paused
    }
    var shouldAutoHideControls: Bool { isPlaying && !isBuffering && state == .ready }

    func play() {
        guard let player else { return }
        let duration = self.duration()
        if didReachEnd || (duration > 0 && currentTime() >= duration - 0.5) {
            seekPlayer(player, to: 0)
        }
        playbackRequested = true
        player.play()
        updateBufferingState(for: player)
        updateNowPlaying(rateOverride: 1)
    }

    func pause() {
        guard let player else { return }
        playbackRequested = false
        player.pause()
        isBuffering = false
        updateNowPlaying(rateOverride: 0)
    }

    func togglePlayPause() {
        if isPlaying { pause() } else { play() }
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
        cancelCountdownTask()
        pendingNextRequest = request
        let generation = countdownGeneration
        countdownTask = Task { @MainActor in
            defer {
                if countdownGeneration == generation {
                    countdownTask = nil
                }
            }
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
            await startNext(request, cancelCountdown: false)
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
        nextCountdown = nil

        // Once the countdown has already entered `startNext`, cancelling its task
        // would abort the one valid transition. In that narrow window, "Play now"
        // simply acknowledges the transition already in progress.
        guard !isNextTransitionInProgress else { return }

        cancelCountdownTask()
        cancelManualNextTask()
        manualNextGeneration &+= 1
        let generation = manualNextGeneration
        manualNextTask = Task { @MainActor in
            defer {
                if manualNextGeneration == generation {
                    manualNextTask = nil
                }
            }
            await startNext(request)
        }
    }

    /// Dismiss the countdown without advancing. `didTriggerNext` stays latched,
    /// so the end-of-stream fallback won't re-arm it for this episode.
    func cancelNextEpisode() {
        cancelCountdownTask()
        nextCountdown = nil
    }

    private func cancelManualNextTask() {
        manualNextGeneration &+= 1
        manualNextTask?.cancel()
        manualNextTask = nil
    }

    func teardown() {
        cancelManualNextTask()
        invalidateNextTransition()
        invalidatePlaybackOperations()
        flushProgress()
        cancelCountdownTask()
        teardownPlayer()
        replaceLiveProxyToken(with: nil)
        releasePlaybackResources()
        NowPlayingCenter.shared.clear()
        activeRequest = nil
        viaProxy = nil
        pendingStartAt = 0
        lastPosition = 0
        state = .idle
    }

    // MARK: - App lifecycle

    /// Record whether the stream was playing as the app backgrounds, so the
    /// foreground recovery only resurrects a stream the user hadn't paused.
    func prepareForBackground() {
        // Use the effective AVPlayer state, not only our last intent: iOS may
        // have paused playback because of an interruption or route change.
        wasPlayingBeforeBackground = isPlaying
        let position = currentTime()
        if position.isFinite, position >= 0 { lastPosition = position }
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
                pendingStartAt = recoveryPosition()
                teardownPlayer()
                loadCurrentSource(request: request)
            } else if wasPlayingBeforeBackground {
                // Still alive but paused/stalled by the dead connection. Nudge
                // it: the reissued segment fetch hits the now-live tunnel (and
                // LocalHLSServer's own stale-tunnel retry as a backstop).
                play()
            }
        }
    }

    // MARK: - Private

    private func installStatusObserver(for item: AVPlayerItem) {
        statusObserver = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
            let status = item.status
            let error = item.error
            Task { @MainActor in
                guard let self, self.player?.currentItem === item else { return }
                self.handleStatus(for: item, status: status, error: error)
            }
        }
    }

    private func handleStatus(for item: AVPlayerItem, status: AVPlayerItem.Status, error: Error? = nil) {
        guard player?.currentItem === item else { return }
        switch status {
        case .readyToPlay:
            state = .ready
            updateBufferingState(for: player)
            // Apply the resume seek once, when the item can actually seek. Keep
            // the target until the completion callback, so a mirror failure or
            // background rebuild during the seek preserves the resume position.
            if pendingStartAt > 1, let player {
                seekPlayer(player, to: pendingStartAt, clearsPendingStartOnCompletion: true)
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
            dumpPlayerItemLogs(for: item)
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
                let message = activeRequest.map { offlineFailureMessage(for: $0, item: item, error: error) }
                    ?? "Riproduzione offline non riuscita."
                failPlayback(message)
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
    private func dumpPlayerItemLogs(for item: AVPlayerItem) {
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
    private func offlineFailureMessage(for request: PlaybackRequest, item: AVPlayerItem, error: Error?) -> String {
        var lines: [String] = []
        if let ns = error as NSError? { lines.append("\(ns.domain) \(ns.code)") }
        if let events = item.errorLog()?.events, !events.isEmpty {
            for event in events.prefix(5) {
                let uri = event.uri ?? "(nil)"
                lines.append("ERR: \(trunc(uri))\n  \(event.errorDomain) \(event.errorStatusCode) \(event.errorComment ?? "")")
            }
        }
        if let events = item.accessLog()?.events, !events.isEmpty {
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
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self, weak player] _ in
            MainActor.assumeIsolated {
                guard let self, let player, self.player === player else { return }
                self.flushProgress()
                self.updateSkipPrompt()
            }
        }
    }

    private func flushProgress() {
        guard let player, let item = player.currentItem else { return }
        let duration = item.duration.seconds
        let safeDuration = duration.isFinite ? duration : 0
        let rawPosition = didReachEnd && safeDuration > 0 ? safeDuration : currentTime()
        let position = safeDuration > 0 ? min(max(0, rawPosition), safeDuration) : max(0, rawPosition)
        guard position.isFinite, position > 0 else { return }
        lastPosition = position
        NowPlayingCenter.shared.update(position: position, duration: safeDuration, rate: player.rate)
        onProgress?(position, safeDuration)
    }

    private func installEndObserver(for item: AVPlayerItem) {
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
        ) { [weak self, weak item] _ in
            MainActor.assumeIsolated {
                guard let self, let item, self.player?.currentItem === item else { return }
                self.handleEnded(for: item)
            }
        }
    }

    private func handleEnded(for item: AVPlayerItem) {
        guard !didReachEnd, player?.currentItem === item else { return }
        didReachEnd = true
        playbackRequested = false
        isBuffering = false
        let duration = item.duration.seconds
        if duration.isFinite, duration > 0 {
            lastPosition = duration
            NowPlayingCenter.shared.update(position: duration, duration: duration, rate: 0)
            onProgress?(duration, duration)
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
        timeControlObserver?.invalidate()
        timeControlObserver = nil
        if let skipBoundaryObserver, let player {
            player.removeTimeObserver(skipBoundaryObserver)
        }
        skipBoundaryObserver = nil
        player?.pause()
        player = nil
        playbackRequested = false
        isBuffering = false
        seekGeneration &+= 1
        seekTarget = nil
        didReachEnd = false
        // Revoke any AirPlay token so the download stops being LAN-reachable.
        LocalHLSServer.shared.endAirplaySession()
    }

    private func installTimeControlObserver(for player: AVPlayer) {
        timeControlObserver = player.observe(\.timeControlStatus, options: [.initial, .new]) { [weak self, weak player] _, _ in
            Task { @MainActor in
                guard let self, let player, self.player === player else { return }
                self.updateBufferingState(for: player)
                self.updateNowPlaying()
            }
        }
    }

    private func updateBufferingState(for player: AVPlayer?) {
        guard let player, self.player === player else {
            isBuffering = false
            return
        }
        isBuffering = playbackRequested && player.timeControlStatus == .waitingToPlayAtSpecifiedRate
    }

    private func updateNowPlaying(position: Double? = nil, rateOverride: Float? = nil) {
        guard let player else { return }
        let pos = position ?? currentTime()
        let rate = rateOverride ?? (isPlaying ? max(player.rate, 1) : 0)
        NowPlayingCenter.shared.update(position: max(0, pos), duration: duration(), rate: rate)
    }

    private func recoveryPosition() -> Double {
        if let seekTarget, seekTarget.isFinite { return max(0, seekTarget) }
        if pendingStartAt.isFinite, pendingStartAt > 0 { return pendingStartAt }
        return max(0, lastPosition)
    }

    private func configureDownloadMode(for request: PlaybackRequest) {
        if request.offlineURL == nil {
            guard !downloadsPausedForPlayback else { return }
            DownloadManager.shared.pauseForPlayback()
            downloadsPausedForPlayback = true
        } else {
            resumeDownloadsIfNeeded()
        }
    }

    private func resumeDownloadsIfNeeded() {
        guard downloadsPausedForPlayback else { return }
        downloadsPausedForPlayback = false
        DownloadManager.shared.resumeAfterPlayback()
    }

    private func replaceLiveProxyToken(with token: String?) {
        let old = activeLiveProxyToken
        activeLiveProxyToken = token
        if let old, old != token {
            LocalHLSServer.shared.revokeLiveProxyToken(old)
        }
    }

    private func releasePlaybackResources() {
        BackgroundKeepAlive.shared.setPlayerActive(false)
        resumeDownloadsIfNeeded()
        if !BackgroundKeepAlive.shared.isActive {
            try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        }
    }

    private func failPlayback(_ message: String) {
        flushProgress()
        teardownPlayer()
        replaceLiveProxyToken(with: nil)
        releasePlaybackResources()
        NowPlayingCenter.shared.clear()
        state = .failed(message)
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
