import SwiftUI
import AVKit

/// Bridges AVPlayerViewController into SwiftUI — gives us native transport
/// controls, PiP, AirPlay route picker and fullscreen for free.
struct AVPlayerContainer: UIViewControllerRepresentable {
    let player: AVPlayer

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let vc = AVPlayerViewController()
        vc.player = player
        vc.allowsPictureInPicturePlayback = true
        vc.canStartPictureInPictureAutomaticallyFromInline = true
        vc.videoGravity = .resizeAspect
        return vc
    }

    func updateUIViewController(_ vc: AVPlayerViewController, context: Context) {
        if vc.player !== player { vc.player = player }
    }
}

/// Netflix-style skip / next-episode bar shown *below* the player. The player
/// shrinks to make room; the bar collapses to zero height when there's nothing
/// to show. Only visible in the inline (non-fullscreen) layout — the OS
/// fullscreen player renders in its own window with nothing beneath it.
private struct SkipControlBar: View {
    let skipPrompt: PlaybackController.SkipPrompt?
    let skipSegment: ClosedRange<Double>?
    let nextCountdown: Int?
    let currentTime: () -> Double
    let onSkip: () -> Void
    let onPlayNext: () -> Void
    let onCancelNext: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Spacer()
            if let n = nextCountdown {
                Button(action: onCancelNext) {
                    Text("Annulla").netflixLabel(faint: true)
                }
                Button(action: onPlayNext) {
                    Label("Prossimo episodio (\(n)s)", systemImage: "play.fill").netflixLabel()
                }
            } else if let prompt = skipPrompt, let seg = skipSegment {
                // Pill fills as playback advances through the segment.
                FillingPill(title: prompt.title, segment: seg, currentTime: currentTime, action: onSkip)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, hasContent ? 14 : 0)
        .frame(maxWidth: .infinity)
        .frame(height: hasContent ? nil : 0)
        .background(Color.black)
        .clipped()
    }

    private var hasContent: Bool { nextCountdown != nil || skipPrompt != nil }
}

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
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 11)
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
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(faint ? Color.white.opacity(0.7) : .white)
            .padding(.horizontal, faint ? 16 : 20)
            .padding(.vertical, 11)
            .background(
                faint ? nil :
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Color.black.opacity(0.55))
                        .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.white.opacity(0.85), lineWidth: 1.5))
            )
            .contentShape(Rectangle())
    }
}

/// Full-screen playback surface. Shows a spinner while resolving the provider
/// source, an error state if it fails, and the AVPlayer once ready.
struct PlayerScreen: View {
    let request: PlaybackRequest
    /// Bubbles (position, duration) up so the watch page can persist progress.
    var onProgress: ((Double, Double) -> Void)?

    @State private var controller = PlaybackController()
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
                    VStack(spacing: 0) {
                        AVPlayerContainer(player: player)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                        SkipControlBar(
                            skipPrompt: controller.skipPrompt,
                            skipSegment: controller.skipSegment,
                            nextCountdown: controller.nextCountdown,
                            currentTime: { controller.currentTime() },
                            onSkip: { controller.performSkip() },
                            onPlayNext: { controller.playNextNow() },
                            onCancelNext: { controller.cancelNextEpisode() }
                        )
                    }
                    .ignoresSafeArea(edges: .top)
                    .animation(.easeInOut(duration: 0.25), value: controller.skipPrompt)
                    .animation(.easeInOut(duration: 0.25), value: controller.nextCountdown)
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
