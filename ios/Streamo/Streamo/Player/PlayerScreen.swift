import SwiftUI
import AVKit

/// Netflix-style skip pill whose interior fills left→right as playback moves
/// through `segment` (full at the segment's end). Driven by `TimelineView`
/// reading live playback time — pause- and seek-aware, no extra observer.
private struct FillingPill: View {
    let title: String
    let segment: ClosedRange<Double>
    let currentTime: () -> Double
    let action: () -> Void

    var body: some View {
        TimelineView(.animation) { _ in
            let frac = fraction
            Button(action: action) {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                Color.black.opacity(0.55)
                                Color.white.opacity(0.28).frame(width: geo.size.width * frac)
                            }
                        }
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                    .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.white.opacity(0.85), lineWidth: 1.5))
                    .contentShape(Rectangle())
            }
        }
    }

    private var fraction: Double {
        let span = segment.upperBound - segment.lowerBound
        guard span > 0 else { return 0 }
        return min(1, max(0, (currentTime() - segment.lowerBound) / span))
    }
}

private extension PlaybackController.SkipPrompt {
    var title: String {
        switch self {
        case .intro: return "Salta intro"
        case .credits: return "Salta crediti"
        }
    }
}

/// Shared Netflix pill styling for the skip / next labels.
private extension View {
    func netflixLabel(faint: Bool = false) -> some View {
        self
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(faint ? Color.white.opacity(0.7) : .white)
            .padding(.horizontal, faint ? 12 : 14)
            .padding(.vertical, 8)
            .background(
                faint ? nil :
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Color.black.opacity(0.55))
                        .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.white.opacity(0.85), lineWidth: 1.5))
            )
            .contentShape(Rectangle())
    }
}

/// Custom transport + skip controls drawn over the video. Replaces
/// AVPlayerViewController's chrome so the skip pill is always reachable (no
/// inline/fullscreen split) and there's an explicit close button. The transport
/// auto-hides while playing; the skip pill / next-episode countdown stay visible
/// regardless so they're never buried.
private struct PlayerControlsOverlay: View {
    let controller: PlaybackController
    let pip: PiPProxy
    let title: String
    let subtitle: String?
    let onClose: () -> Void

    @State private var chromeVisible = true
    @State private var hideTask: Task<Void, Never>?
    @State private var scrubbing = false
    @State private var scrubFraction = 0.0
    // Polled ~3×/s while the chrome is up — drives the scrubber, timecodes and
    // play/pause glyph without wrapping the drag gesture in a TimelineView
    // (which would re-create the gesture every frame).
    @State private var position = 0.0
    @State private var videoDuration = 0.0
    @State private var playing = false

    var body: some View {
        ZStack {
            // Center tap mirrors the native player: play/pause. Edge taps still
            // toggle the transport chrome.
            GeometryReader { geo in
                Color.black.opacity(chromeVisible ? 0.35 : 0.001)
                    .contentShape(Rectangle())
                    .gesture(
                        SpatialTapGesture().onEnded { value in
                            handleSurfaceTap(at: value.location, size: geo.size)
                        }
                    )
                    .simultaneousGesture(horizontalSeekGesture)
            }

            if chromeVisible { chrome }

            // Skip pill / countdown — always on top, bottom-trailing.
            skipOverlay
        }
        .animation(.easeInOut(duration: 0.2), value: chromeVisible)
        .onAppear { scheduleHide() }
        .onDisappear { hideTask?.cancel() }
        // Poll playback state only while the chrome is visible. `.task(id:)`
        // auto-cancels when chromeVisible flips or the view disappears.
        .task(id: chromeVisible) {
            guard chromeVisible else { return }
            while !Task.isCancelled && chromeVisible {
                if !scrubbing {
                    position = controller.currentTime()
                    videoDuration = controller.duration()
                }
                playing = controller.isPlaying
                try? await Task.sleep(for: .milliseconds(300))
            }
        }
        // Arm the auto-hide once playback actually starts (covers a delayed
        // buffering start where the initial scheduleHide saw a paused player).
        .onChange(of: playing) { _, isPlaying in
            if isPlaying, chromeVisible { scheduleHide() }
        }
    }

    // MARK: Chrome (auto-hiding transport)

    private var chrome: some View {
        VStack(spacing: 0) {
            topBar
            Spacer()
            centerControls
            Spacer()
            bottomBar
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .transition(.opacity)
    }

    private var topBar: some View {
        HStack(alignment: .center, spacing: 14) {
            Button(action: onClose) {
                Image(systemName: "xmark").font(.system(size: 18, weight: .semibold)).foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 16, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                if let subtitle { Text(subtitle).font(.system(size: 13)).foregroundStyle(.white.opacity(0.7)) }
            }
            Spacer()
            AirPlayRoutePicker().frame(width: 40, height: 40)
            if pip.isPossible {
                Button { pip.toggle(); resetHideTimer() } label: {
                    Image(systemName: "pip.enter").font(.system(size: 20)).foregroundStyle(.white)
                }
            }
        }
    }

    private var centerControls: some View {
        HStack(spacing: 50) {
            Button { controller.skip(by: -10); resetHideTimer() } label: {
                Image(systemName: "gobackward.10").font(.system(size: 30)).foregroundStyle(.white)
            }
            Button {
                controller.togglePlayPause()
                playing = controller.isPlaying   // immediate glyph update, don't wait for the poll
                resetHideTimer()
            } label: {
                Image(systemName: playing ? "pause.fill" : "play.fill")
                    .font(.system(size: 44)).foregroundStyle(.white)
            }
            Button { controller.skip(by: 10); resetHideTimer() } label: {
                Image(systemName: "goforward.10").font(.system(size: 30)).foregroundStyle(.white)
            }
        }
    }

    private var bottomBar: some View {
        let current = scrubbing ? scrubFraction * videoDuration : position
        return VStack(spacing: 6) {
            scrubber(duration: videoDuration, current: current)
            HStack {
                Text(Self.timecode(current)).font(.system(size: 12, design: .monospaced)).foregroundStyle(.white.opacity(0.85))
                Spacer()
                Text(Self.timecode(videoDuration)).font(.system(size: 12, design: .monospaced)).foregroundStyle(.white.opacity(0.85))
            }
        }
    }

    private func scrubber(duration: Double, current: Double) -> some View {
        GeometryReader { geo in
            let frac = duration > 0 ? min(1, max(0, current / duration)) : 0
            let w = geo.size.width
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.3)).frame(height: 4)
                Capsule().fill(Color.white).frame(width: w * frac, height: 4)
                Circle().fill(Color.white).frame(width: 14, height: 14)
                    .offset(x: max(0, w * frac - 7))
            }
            .frame(maxHeight: .infinity, alignment: .center)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { v in
                        scrubbing = true
                        scrubFraction = min(1, max(0, v.location.x / w))
                        resetHideTimer()
                    }
                    .onEnded { _ in
                        if duration > 0 {
                            let target = scrubFraction * duration
                            position = target          // avoid a stale-position flash before the next poll
                            controller.seek(to: target)
                        }
                        scrubbing = false
                    }
            )
        }
        .frame(height: 20)
    }

    // MARK: Skip pill / next-episode (always visible)

    private var skipOverlay: some View {
        VStack {
            Spacer()
            HStack(spacing: 12) {
                Spacer()
                if let n = controller.nextCountdown {
                    Button { controller.cancelNextEpisode() } label: { Text("Annulla").netflixLabel(faint: true) }
                    Button { controller.playNextNow() } label: {
                        Label("Prossimo episodio (\(n)s)", systemImage: "play.fill").netflixLabel()
                    }
                } else if let prompt = controller.skipPrompt, let seg = controller.skipSegment {
                    FillingPill(title: prompt.title, segment: seg, currentTime: { controller.currentTime() }, action: { controller.performSkip() })
                }
            }
            .padding(.horizontal, 20)
            // Sit above the scrubber when the chrome is up.
            .padding(.bottom, chromeVisible ? 70 : 24)
        }
        .animation(.easeInOut(duration: 0.25), value: controller.skipPrompt)
        .animation(.easeInOut(duration: 0.25), value: controller.nextCountdown)
    }

    // MARK: Chrome visibility

    private func toggleChrome() {
        chromeVisible.toggle()
        if chromeVisible { scheduleHide() } else { hideTask?.cancel() }
    }

    private func handleSurfaceTap(at location: CGPoint, size: CGSize) {
        let centerRect = CGRect(
            x: size.width * 0.22,
            y: size.height * 0.22,
            width: size.width * 0.56,
            height: size.height * 0.56
        )
        if centerRect.contains(location) {
            togglePlaybackFromSurface()
        } else {
            toggleChrome()
        }
    }

    private func togglePlaybackFromSurface() {
        controller.togglePlayPause()
        playing = controller.isPlaying
        chromeVisible = true
        if playing {
            scheduleHide()
        } else {
            hideTask?.cancel()
        }
    }

    private func resetHideTimer() { if chromeVisible { scheduleHide() } }

    private var horizontalSeekGesture: some Gesture {
        DragGesture(minimumDistance: 42, coordinateSpace: .local)
            .onEnded { value in
                let dx = value.translation.width
                let dy = value.translation.height
                guard abs(dx) > abs(dy) * 1.4 else { return }
                controller.skip(by: dx > 0 ? 10 : -10)
                if chromeVisible {
                    position = controller.currentTime()
                    resetHideTimer()
                }
            }
    }

    /// Auto-hide the chrome after a few seconds of no interaction (only while
    /// playing — a paused player keeps its controls up).
    private func scheduleHide() {
        hideTask?.cancel()
        hideTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(4))
            if !Task.isCancelled, controller.isPlaying { chromeVisible = false }
        }
    }

    private static func timecode(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "0:00" }
        let s = Int(seconds)
        let h = s / 3600, m = (s % 3600) / 60, sec = s % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, sec) : String(format: "%d:%02d", m, sec)
    }
}

/// Full-screen playback surface. Shows a spinner while resolving the provider
/// source, an error state if it fails, and the AVPlayer once ready.
struct PlayerScreen: View {
    let request: PlaybackRequest
    /// Bubbles (position, duration) up so the watch page can persist progress.
    var onProgress: ((Double, Double) -> Void)?

    @State private var controller = PlaybackController()
    @State private var pip = PiPProxy()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(Library.self) private var library

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            // While resolving / on error, show the title artwork behind the
            // content instead of a bare black screen.
            if case .ready = controller.state {} else {
                artworkBackground
            }

            switch controller.state {
            case .idle, .resolving:
                VStack(spacing: 16) {
                    ProgressView().tint(.white)
                    Text(request.title).font(.headline).foregroundStyle(.white).multilineTextAlignment(.center).padding(.horizontal, 40)
                    Text("Caricamento stream…").font(.subheadline).foregroundStyle(.white.opacity(0.7))
                    if let viaProxy = controller.viaProxy {
                        WarpBadge(viaProxy: viaProxy, streaming: true)
                    }
                }
            case .ready:
                if let player = controller.player {
                    ZStack {
                        PlayerLayerView(player: player, pip: pip)
                        PlayerControlsOverlay(
                            controller: controller,
                            pip: pip,
                            title: request.title,
                            subtitle: request.mediaType == .tv ? "S\(request.season) · E\(request.episode)" : nil,
                            onClose: { dismiss() }
                        )
                    }
                }
            case .failed(let message):
                VStack(spacing: 16) {
                    Image(systemName: "exclamationmark.triangle").font(.largeTitle).foregroundStyle(.yellow)
                    Text(request.title).font(.headline).foregroundStyle(.white)
                    ScrollView {
                        Text(message)
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundStyle(.white.opacity(0.85))
                            .textSelection(.enabled)
                            .multilineTextAlignment(.leading)
                            .padding(.horizontal, 24)
                    }
                    .frame(maxHeight: 360)
                    Button("Chiudi") { dismiss() }.buttonStyle(BrandButtonStyle(kind: .primary, fullWidth: false))
                }
            }

            if case .ready = controller.state {} else {
                VStack {
                    HStack {
                        Spacer()
                        Button { dismiss() } label: {
                            Image(systemName: "xmark.circle.fill").font(.title).foregroundStyle(.white.opacity(0.7))
                        }
                        .padding()
                    }
                    Spacer()
                }
            }
        }
        .task {
            OrientationLock.unlockForPlayer()
            controller.onProgress = { position, duration in
                persist(position: position, duration: duration)
                onProgress?(position, duration)
            }
            controller.onCompleted = {
                if let r = controller.activeRequest {
                    library.saveHistory(tmdbId: r.tmdbId, type: r.mediaType,
                                        season: r.season, episode: r.episode,
                                        title: r.title, poster: r.poster, source: r.source)
                }
                // Fallback: only auto-advance from the literal end when the
                // credits-driven path hasn't already fired (no credits data).
                if !controller.didTriggerNext { resolveAndArmNext(immediate: true) }
            }
            // Credits reached: advance early (with a cancellable countdown).
            controller.onCreditsReached = { resolveAndArmNext() }
            await controller.start(request)
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                controller.prepareForBackground()
            case .active:
                // iOS may have killed the WARP tunnel / loopback connection
                // during suspension; recover the stream instead of leaving it
                // stalled (lock-screen → resume → playback frozen).
                controller.handleForeground()
            default:
                break
            }
        }
        .onDisappear {
            let req = controller.activeRequest
            controller.teardown()   // flushes final progress before we check
            autoDeleteIfWatched(req)
            OrientationLock.lockPortrait()
        }
    }

    /// If enabled, delete a download once it's been watched (≥90%). Runs after
    /// teardown so the player no longer references the file.
    private func autoDeleteIfWatched(_ req: PlaybackRequest?) {
        guard AppSettings.shared.autoDeleteWatchedDownloads, let r = req,
              let p = library.progress(r.tmdbId, r.mediaType, season: r.season, episode: r.episode, source: r.source),
              TVLogic.isWatched(position: p.position, duration: p.duration),
              let dl = library.download(r.tmdbId, r.mediaType, season: r.season, episode: r.episode, source: r.source),
              dl.state == .completed else { return }
        DownloadManager.shared.delete(dl)
    }

    /// Artwork URL for the loading/error backdrop. AnimeUnity carries an
    /// absolute image URL; TMDB carries a path resolved through `TmdbImage`.
    private var artworkURL: URL? {
        if request.source == .animeUnity {
            return request.artworkURLString.flatMap(URL.init(string:))
        }
        return TmdbImage.url(request.backdrop ?? request.poster, .w1280)
    }

    /// Blurred title artwork shown behind the loading / error states.
    private var artworkBackground: some View {
        Group {
            if let url = artworkURL {
                PosterImage(url: url, contentMode: .fill)
            } else {
                Color.black
            }
        }
        .ignoresSafeArea()
        .overlay(Color.black.opacity(0.6).ignoresSafeArea())
        .blur(radius: 6)
    }

    /// Persist progress (and a history row once past the 15s "actually started"
    /// gate) under the *currently playing* episode — mirrors the web
    /// PlayerService.persistProgress. Uses controller.activeRequest so it stays
    /// correct after autoplay advances to the next episode.
    private func persist(position: Double, duration: Double) {
        // Web persists progress only past 15s ("actually started"); below that
        // a brief blip shouldn't write a resume row or a history entry.
        guard position > 15, let r = controller.activeRequest else { return }
        library.saveProgress(
            tmdbId: r.tmdbId, type: r.mediaType,
            season: r.season, episode: r.episode,
            position: position, duration: duration,
            title: r.title, poster: r.poster, backdrop: r.backdrop, source: r.source,
            providerEpisodeId: r.animeEpisodeId, providerSlug: r.animeSlug
        )
        library.saveHistory(tmdbId: r.tmdbId, type: r.mediaType,
                            season: r.season, episode: r.episode,
                            title: r.title, poster: r.poster, source: r.source)
    }

    /// Advance a finished TV episode to the next aired one — native replacement
    /// for embed-bridge.js autoplay. Single path shared by both triggers:
    /// `onCreditsReached` (early, arms a cancellable countdown) and the
    /// `onCompleted` end-of-stream fallback (`immediate`). Gated by the existing
    /// `autoplayNext` setting; `startNext` only switches if the next episode
    /// actually resolves, so a missing one leaves playback put.
    private func resolveAndArmNext(immediate: Bool = false) {
        // Anime autoplay-next is driven from AnimeDetailView (it has the ordered
        // episode-id list); TMDB autoplay uses the show's season layout here.
        guard AppSettings.shared.autoplayNext,
              let cur = controller.activeRequest, cur.source == .tmdb, cur.mediaType == .tv else { return }
        Task {
            guard let item = try? await TMDBClient.shared.details(id: cur.tmdbId, type: .tv),
                  let next = TVLogic.nextEpisode(item, season: cur.season, episode: cur.episode) else { return }
            let nextReq = PlaybackRequest(
                tmdbId: cur.tmdbId, mediaType: .tv, title: cur.title, releaseDate: cur.releaseDate,
                poster: cur.poster, backdrop: cur.backdrop, season: next.season, episode: next.episode, startAt: 0
            )
            if immediate {
                await controller.startNext(nextReq)
            } else {
                controller.armNextEpisode(nextReq)
            }
        }
    }
}
