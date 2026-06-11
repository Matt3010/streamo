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

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor in self?.isOnline = online }
            // A path change (Wi-Fi↔cellular, link gained/lost) can kill the WARP
            // tunnel's UDP socket while `isReady` still reads true — flag it so
            // the next start() re-probes and restarts instead of using a dead
            // session. No-op when the tunnel isn't running.
            Task { await WarpTunnel.shared.invalidate() }
        }
        monitor.start(queue: DispatchQueue(label: "streamo.network.monitor"))
    }
}
