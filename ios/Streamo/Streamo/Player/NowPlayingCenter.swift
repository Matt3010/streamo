import Foundation
import MediaPlayer
import UIKit

/// Lock screen / Control Center "Now Playing" info + remote transport commands.
/// A singleton: the remote-command targets are registered once for the app and
/// dispatch to whatever closures the active PlaybackController installs, so
/// handlers don't stack across playbacks.
@MainActor
final class NowPlayingCenter {
    static let shared = NowPlayingCenter()

    var onPlay: (() -> Void)?
    var onPause: (() -> Void)?
    var onToggle: (() -> Void)?
    /// Relative skip in seconds (positive = forward).
    var onSkip: ((Double) -> Void)?
    /// Absolute seek in seconds.
    var onSeek: ((Double) -> Void)?

    private var configured = false
    private var artworkToken = 0

    private init() {}

    func configureCommands() {
        guard !configured else { return }
        configured = true
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { [weak self] _ in self?.onPlay?(); return .success }
        c.pauseCommand.addTarget { [weak self] _ in self?.onPause?(); return .success }
        c.togglePlayPauseCommand.addTarget { [weak self] _ in self?.onToggle?(); return .success }

        c.skipForwardCommand.preferredIntervals = [15]
        c.skipForwardCommand.addTarget { [weak self] event in
            self?.onSkip?((event as? MPSkipIntervalCommandEvent)?.interval ?? 15); return .success
        }
        c.skipBackwardCommand.preferredIntervals = [15]
        c.skipBackwardCommand.addTarget { [weak self] event in
            self?.onSkip?(-((event as? MPSkipIntervalCommandEvent)?.interval ?? 15)); return .success
        }
        c.changePlaybackPositionCommand.addTarget { [weak self] event in
            if let ev = event as? MPChangePlaybackPositionCommandEvent { self?.onSeek?(ev.positionTime) }
            return .success
        }
    }

    func setMetadata(title: String, subtitle: String?, duration: Double, posterURL: URL?) {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPNowPlayingInfoPropertyPlaybackRate: 1.0,
        ]
        if let subtitle { info[MPMediaItemPropertyArtist] = subtitle }
        if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info

        artworkToken &+= 1
        let token = artworkToken
        if let posterURL { Task { await loadArtwork(posterURL, token: token) } }
    }

    func update(position: Double, duration: Double, rate: Float) {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = position
        if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        info[MPNowPlayingInfoPropertyPlaybackRate] = rate
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    func clear() {
        artworkToken &+= 1
        onPlay = nil; onPause = nil; onToggle = nil; onSkip = nil; onSeek = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    private func loadArtwork(_ url: URL, token: Int) async {
        // TMDB artwork is neutral metadata — always direct, never through WARP.
        guard let (data, _) = try? await URLSession.shared.data(from: url),
              let image = UIImage(data: data), token == artworkToken else { return }
        let art = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPMediaItemPropertyArtwork] = art
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
}
