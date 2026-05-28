import Foundation
import AVFoundation
import Observation

/// Plays a zero-filled audio buffer in a loop so iOS doesn't suspend the
/// process while the LAN HTTP server should stay reachable. Used only when
/// the user has explicitly enabled "Condivisione LAN" — outside that, the
/// app behaves like any other (background suspension after ~30s).
///
/// Trade-offs the user agreed to:
///   - the audio-in-use indicator appears in Control Center / lock screen
///   - extra battery drain (CPU stays awake)
///   - relies on the `audio` UIBackgroundMode that's already in Info.plist
@MainActor
@Observable
final class BackgroundKeepAlive {
    static let shared = BackgroundKeepAlive()

    private(set) var isActive = false
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private var observersInstalled = false

    private init() {}

    func start() {
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
            // next user toggle / interruption-ended event.
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

    func stop() {
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
    /// kill the LAN server.
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
            Task { @MainActor in self?.restartIfNeeded() }
        }
    }

    private func handleInterruption(_ note: Notification) {
        guard let info = note.userInfo,
              let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        switch type {
        case .began:
            // System paused our engine; remember we wanted to be running.
            isActive = false
        case .ended:
            // Try to resume — the user still wants LAN-share alive.
            start()
        @unknown default:
            break
        }
    }

    private func restartIfNeeded() {
        guard isActive == false else { return }
        start()
    }
}
