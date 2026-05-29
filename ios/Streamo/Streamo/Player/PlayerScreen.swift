import SwiftUI
import AVKit

/// Bridges AVPlayerViewController into SwiftUI — gives us native transport
/// controls, PiP, AirPlay route picker and fullscreen for free.
struct AVPlayerContainer: UIViewControllerRepresentable {
    let player: AVPlayer
    /// Fires on every tap inside the player surface. AVKit toggles its native
    /// controls on the same tap; we use this to reveal our overlay badge in
    /// sync. The recognizer doesn't consume the touch, so AVKit still gets it.
    var onTap: () -> Void = {}

    func makeCoordinator() -> Coordinator { Coordinator(onTap: onTap) }

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let vc = AVPlayerViewController()
        vc.player = player
        vc.allowsPictureInPicturePlayback = true
        vc.canStartPictureInPictureAutomaticallyFromInline = true
        vc.videoGravity = .resizeAspect
        let tap = UITapGestureRecognizer(target: context.coordinator,
                                         action: #selector(Coordinator.handleTap))
        tap.cancelsTouchesInView = false
        tap.delegate = context.coordinator
        vc.view.addGestureRecognizer(tap)
        return vc
    }

    func updateUIViewController(_ vc: AVPlayerViewController, context: Context) {
        if vc.player !== player { vc.player = player }
        context.coordinator.onTap = onTap
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var onTap: () -> Void
        init(onTap: @escaping () -> Void) { self.onTap = onTap }
        @objc func handleTap() { onTap() }
        // Run alongside AVKit's own tap handling rather than blocking it.
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
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
    @Environment(Library.self) private var library

    /// Mirrors the native player-controls visibility for our overlay badge:
    /// AVKit doesn't expose its controls state, so we reveal the badge on tap
    /// and auto-hide it after a few idle seconds, matching the controls' rhythm.
    @State private var controlsVisible = true
    @State private var hideControlsTask: Task<Void, Never>?

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
                    AVPlayerContainer(player: player, onTap: { revealControlsTransiently() })
                        .ignoresSafeArea()
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

            // WARP/Diretto badge during online playback. Top-leading, on the
            // material chrome so it reads as part of the player, and shown/hidden
            // in sync with the native controls (revealed on tap, auto-hidden).
            // Non-interactive so it never steals taps from the controls below.
            // Offline playback (viaProxy nil) shows nothing — no provider involved.
            if case .ready = controller.state, let viaProxy = controller.viaProxy {
                VStack {
                    HStack {
                        WarpBadge(viaProxy: viaProxy)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(.ultraThinMaterial, in: Capsule())
                            .padding(.leading, 16)
                            .padding(.top, 12)
                        Spacer()
                    }
                    Spacer()
                }
                .opacity(controlsVisible ? 1 : 0)
                .animation(.easeInOut(duration: 0.25), value: controlsVisible)
                .allowsHitTesting(false)
            }
        }
        .onChange(of: controller.state) { _, newValue in
            // AVKit shows its controls when playback becomes ready; mirror that
            // initial reveal (and the subsequent auto-hide) for our badge.
            if case .ready = newValue { revealControlsTransiently() }
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
                                        title: r.title, poster: r.poster)
                }
                maybeAutoplayNext()
            }
            await controller.start(request)
        }
        .onDisappear {
            hideControlsTask?.cancel()
            let req = controller.activeRequest
            controller.teardown()   // flushes final progress before we check
            autoDeleteIfWatched(req)
            OrientationLock.lockPortrait()
        }
    }

    /// Reveal the overlay badge and schedule its auto-hide, matching how the
    /// native controls fade out after a few idle seconds. Re-tapping resets the
    /// timer, so the badge stays up while the user is interacting.
    private func revealControlsTransiently() {
        hideControlsTask?.cancel()
        withAnimation(.easeInOut(duration: 0.2)) { controlsVisible = true }
        hideControlsTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            withAnimation(.easeInOut(duration: 0.25)) { controlsVisible = false }
        }
    }

    /// If enabled, delete a download once it's been watched (≥90%). Runs after
    /// teardown so the player no longer references the file.
    private func autoDeleteIfWatched(_ req: PlaybackRequest?) {
        guard AppSettings.shared.autoDeleteWatchedDownloads, let r = req,
              let p = library.progress(r.tmdbId, r.mediaType, season: r.season, episode: r.episode),
              p.duration > 0, p.position >= p.duration * TVLogic.watchedThreshold,
              let dl = library.download(r.tmdbId, r.mediaType, season: r.season, episode: r.episode),
              dl.state == .completed else { return }
        DownloadManager.shared.delete(dl)
    }

    /// Blurred title artwork shown behind the loading / error states.
    private var artworkBackground: some View {
        Group {
            if let url = TmdbImage.url(request.backdrop ?? request.poster, .w1280) {
                AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Color.black }
            } else {
                Color.black
            }
        }
        .ignoresSafeArea()
        .overlay(Color.black.opacity(0.6).ignoresSafeArea())
        .blur(radius: 6)
    }

    /// Persist progress (and a history row once past the 10s "actually started"
    /// gate) under the *currently playing* episode — mirrors the web
    /// PlayerService.persistProgress. Uses controller.activeRequest so it stays
    /// correct after autoplay advances to the next episode.
    private func persist(position: Double, duration: Double) {
        // Web persists progress only past 10s ("actually started"); below that
        // a brief blip shouldn't write a resume row or a history entry.
        guard position > 10, let r = controller.activeRequest else { return }
        library.saveProgress(
            tmdbId: r.tmdbId, type: r.mediaType,
            season: r.season, episode: r.episode,
            position: position, duration: duration,
            title: r.title, poster: r.poster, backdrop: r.backdrop
        )
        library.saveHistory(tmdbId: r.tmdbId, type: r.mediaType,
                            season: r.season, episode: r.episode,
                            title: r.title, poster: r.poster)
    }

    /// When the setting is on, advance a finished TV episode to the next aired
    /// one — native replacement for embed-bridge.js autoplay.
    private func maybeAutoplayNext() {
        guard AppSettings.shared.autoplayNext,
              let cur = controller.activeRequest, cur.mediaType == .tv else { return }
        Task {
            guard let item = try? await TMDBClient.shared.details(id: cur.tmdbId, type: .tv),
                  let next = TVLogic.nextEpisode(item, season: cur.season, episode: cur.episode) else { return }
            let nextReq = PlaybackRequest(
                tmdbId: cur.tmdbId, mediaType: .tv, title: cur.title, releaseDate: cur.releaseDate,
                poster: cur.poster, backdrop: cur.backdrop, season: next.season, episode: next.episode, startAt: 0
            )
            // Only advance if the next episode actually resolves — otherwise
            // stay put rather than showing an error screen.
            await controller.startNext(nextReq)
        }
    }
}
