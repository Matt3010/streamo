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

/// Full-screen playback surface. Shows a spinner while resolving the provider
/// source, an error state if it fails, and the AVPlayer once ready.
struct PlayerScreen: View {
    let request: PlaybackRequest
    /// Bubbles (position, duration) up so the watch page can persist progress.
    var onProgress: ((Double, Double) -> Void)?

    @State private var controller = PlaybackController()
    @Environment(\.dismiss) private var dismiss
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
                    AVPlayerContainer(player: player).ignoresSafeArea()
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
                                        title: r.title, poster: r.poster)
                }
                maybeAutoplayNext()
            }
            await controller.start(request)
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
