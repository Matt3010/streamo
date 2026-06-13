import Network
import Observation

/// Tracks connectivity via NWPathMonitor. When offline, `RootTabView` swaps
/// the whole UI for the Downloads-only root, so we don't need an in-band
/// banner anywhere else.
@MainActor
@Observable
final class NetworkMonitor {
    static let shared = NetworkMonitor()
    private(set) var isOnline = true
    private let monitor = NWPathMonitor()
    /// Signature of the last path we acted on (status + interface identity).
    /// Only ever touched inside the path handler, which runs on the serial
    /// `monitor` queue — single-threaded, so the `unsafe` access is safe.
    @ObservationIgnored private nonisolated(unsafe) var lastPathSignature: String?

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            guard let self else { return }
            let online = path.status == .satisfied
            Task { @MainActor in self.isOnline = online }
            // A path change (Wi-Fi↔cellular, link gained/lost) can kill the WARP
            // tunnel's UDP socket while `isReady` still reads true — flag it so
            // the next start() re-probes and restarts instead of using a dead
            // session. No-op when the tunnel isn't running.
            //
            // NWPathMonitor fires several callbacks per handoff, many benign
            // (.satisfied → .satisfied, same interface). Invalidate ONLY when the
            // path materially changed, else a flapping connection forces repeated
            // ~16s tunnel rebuilds that stall playback. The signature folds in the
            // status and the available interfaces' identity.
            let signature = "\(path.status)|" + path.availableInterfaces
                .map { "\($0.type)/\($0.name)" }.joined(separator: ",")
            guard signature != self.lastPathSignature else { return }
            self.lastPathSignature = signature
            Task { await WarpTunnel.shared.invalidate() }
        }
        monitor.start(queue: DispatchQueue(label: "streamo.network.monitor"))
    }
}
