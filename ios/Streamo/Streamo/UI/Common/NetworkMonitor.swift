import SwiftUI
import Network
import Observation

/// Tracks connectivity via NWPathMonitor — drives the offline banner.
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

/// Red banner shown at the top when offline — port of the web offline-banner.
struct OfflineBanner: View {
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "wifi.slash").font(.subheadline.weight(.bold))
            VStack(alignment: .leading, spacing: 1) {
                Text("Sei offline.").font(.subheadline.bold())
                Text("Alcune funzioni potrebbero non essere disponibili finché la connessione non torna.")
                    .font(.caption2)
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.red)
    }
}
