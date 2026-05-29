import Foundation
import AVFoundation
import Observation

/// Plays a zero-filled audio buffer in a loop so iOS doesn't suspend the
/// process while something on-device needs to keep running in the background.
/// Two independent features rely on it:
///   - "Condivisione LAN" — keeps the LAN HTTP server reachable
///   - active downloads — lets `DownloadManager` keep fetching segments after
///     the user backgrounds the app
///
/// Each feature is a `Reason`. The engine runs while *any* reason is held and
/// stops once the last one is released, so turning off LAN sharing doesn't
/// kill a download in flight and vice-versa.
///
/// Trade-offs the user agreed to:
///   - the audio-in-use indicator appears in Control Center / lock screen
///   - extra battery drain (CPU stays awake)
///   - relies on the `audio` UIBackgroundMode that's already in Info.plist
@MainActor
@Observable
final class BackgroundKeepAlive {
    static let shared = BackgroundKeepAlive()

    /// Why the keep-alive is being held. The engine runs while the set is
    /// non-empty.
    enum Reason: Hashable {
        case lanShare
        case activeDownload
    }

    /// True while the silent-audio engine is actually running.
    private(set) var isActive = false

    @ObservationIgnored private var reasons = Set<Reason>()
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private var observersInstalled = false

    private init() {}

    // MARK: - Reason-based gating

    /// Add or remove a reason to keep the process alive. The engine starts
    /// when the first reason is held and stops when the last is released.
    func setReason(_ reason: Reason, active: Bool) {
        let wasEmpty = reasons.isEmpty
        if active { reasons.insert(reason) } else { reasons.remove(reason) }
        if !reasons.isEmpty, wasEmpty {
            activate()
        } else if reasons.isEmpty, !wasEmpty {
            deactivate()
        }
    }

    /// LAN-sharing entry points (kept for source compatibility with
    /// `LANShareCoordinator` / `RootTabView`).
    func start() { setReason(.lanShare, active: true) }
    func stop() { setReason(.lanShare, active: false) }

    // MARK: - Engine

    private func activate() {
        guard !isActive else { return }
        do {
            let session = AVAudioSession.sharedInstance()
            // `.mixWithOthers` lets the user's music keep playing on the
            // phone while our silent keep-alive runs alongside it.
            try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try session.setActive(true, options: [])
        } catch {
            // If activation failed (e.g. another app holds exclusive audio
            // right now), leave the engine idle — we'll try again on the
            // next reason change / interruption-ended event.
            return
        }

        let format = engine.mainMixerNode.outputFormat(forBus: 0)
        // 1 second of zero-filled PCM, looped — enough that we never burn
        // CPU re-scheduling, and short enough to keep memory usage trivial.
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format,
                                            frameCapacity: AVAudioFrameCount(format.sampleRate)) else { return }
        buffer.frameLength = buffer.frameCapacity
        // AVAudioPCMBuffer allocates zeroed memory, so the data is already
        // silent — no explicit fill needed.

        if engine.attachedNodes.contains(player) == false {
            engine.attach(player)
        }
        engine.connect(player, to: engine.mainMixerNode, format: format)

        do {
            try engine.start()
        } catch {
            try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
            return
        }
        player.scheduleBuffer(buffer, at: nil, options: [.loops], completionHandler: nil)
        player.play()
        isActive = true

        installObservers()
    }

    private func deactivate() {
        guard isActive else { return }
        player.stop()
        engine.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        isActive = false
    }

    // MARK: - Interruption handling

    /// Calls, alarms, Siri, headphone unplug all generate `interruption`
    /// or `routeChange` notifications that can stop the audio engine. We
    /// re-arm ourselves on `.ended` so a phone call doesn't permanently
    /// kill an in-flight download or the LAN server.
    private func installObservers() {
        guard !observersInstalled else { return }
        observersInstalled = true
        let nc = NotificationCenter.default
        nc.addObserver(forName: AVAudioSession.interruptionNotification,
                       object: nil, queue: .main) { [weak self] note in
            Task { @MainActor in self?.handleInterruption(note) }
        }
        nc.addObserver(forName: .AVAudioEngineConfigurationChange,
                       object: engine, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.reactivateIfNeeded() }
        }
    }

    private func handleInterruption(_ note: Notification) {
        guard let info = note.userInfo,
              let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        switch type {
        case .began:
            // System paused our engine; remember we still want to be running.
            isActive = false
        case .ended:
            // Try to resume — a reason (LAN / download) may still be held.
            reactivateIfNeeded()
        @unknown default:
            break
        }
    }

    /// Restart the engine if it stopped (interruption / config change) but a
    /// reason is still held.
    private func reactivateIfNeeded() {
        guard isActive == false, !reasons.isEmpty else { return }
        activate()
    }
}
