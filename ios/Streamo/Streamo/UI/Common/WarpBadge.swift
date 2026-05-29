import SwiftUI

/// Compact connection-protection indicator with three states:
/// - **green shield** — fetched through the WARP proxy with its egress up (safe);
/// - **gray shield** — fetched directly / proxy off (a deliberate choice, neutral);
/// - **red shield** — proxy used but its WARP egress was down (you expect to be
///   protected but you aren't — a fault worth flagging).
/// Used by the Downloads list and the player.
struct WarpBadge: View {
    let viaProxy: Bool
    /// Only meaningful when `viaProxy` is true: whether the proxy's WARP egress
    /// was up. `nil` (unknown / still resolving) is treated as up.
    var warpHealthy: Bool?
    /// When true (player, dark background) the labels are more descriptive.
    var streaming: Bool = false

    private enum Status { case warped, warpDown, direct }

    private var status: Status {
        guard viaProxy else { return .direct }
        return (warpHealthy ?? true) ? .warped : .warpDown
    }

    var body: some View {
        Label {
            Text(label)
        } icon: {
            Image(systemName: icon)
        }
        .font(.caption2.weight(.semibold))
        .foregroundStyle(tint)
        .accessibilityLabel(accessibility)
    }

    private var icon: String {
        switch status {
        case .warped:   return "lock.shield.fill"
        case .warpDown: return "exclamationmark.shield.fill"
        case .direct:   return "shield.slash"
        }
    }

    private var tint: Color {
        switch status {
        case .warped:   return .green
        case .warpDown: return .red
        case .direct:   return .gray
        }
    }

    private var label: String {
        switch status {
        case .warped:   return streaming ? "via WARP" : "WARP"
        case .warpDown: return streaming ? "WARP non attivo" : "WARP KO"
        case .direct:   return streaming ? "Connessione diretta" : "Diretto"
        }
    }

    private var accessibility: String {
        switch status {
        case .warped:   return "Tramite proxy WARP attivo"
        case .warpDown: return "Proxy attivo ma WARP del server non funzionante"
        case .direct:   return "Connessione diretta, senza WARP"
        }
    }
}
