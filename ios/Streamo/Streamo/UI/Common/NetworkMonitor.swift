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
        }
        monitor.start(queue: DispatchQueue(label: "streamo.network.monitor"))
    }
}
