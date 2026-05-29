import SwiftUI

/// Compact connection indicator:
/// - **green shield** — fetched through the WARP proxy (protected). If content
///   loaded via the proxy at all, its WARP egress was necessarily up, so this is
///   always the safe state.
/// - **gray shield** — fetched directly / proxy off (a deliberate choice).
/// There is no "proxy but WARP down" state: if the server's WARP were down the
/// proxy couldn't reach the provider, so nothing would play or download.
/// Used by the Downloads list and the player.
struct WarpBadge: View {
    let viaProxy: Bool
    /// When true (player, dark background) the labels are more descriptive.
    var streaming: Bool = false

    var body: some View {
        Label {
            Text(label)
        } icon: {
            Image(systemName: viaProxy ? "lock.shield.fill" : "shield.slash")
        }
        .font(.caption2.weight(.semibold))
        .foregroundStyle(viaProxy ? Color.green : Color.gray)
        .accessibilityLabel(viaProxy ? "Tramite proxy WARP" : "Connessione diretta, senza WARP")
    }

    private var label: String {
        if streaming { return viaProxy ? "via WARP" : "Connessione diretta" }
        return viaProxy ? "WARP" : "Diretto"
    }
}