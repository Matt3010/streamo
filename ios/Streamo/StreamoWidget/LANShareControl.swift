import WidgetKit
import SwiftUI
import AppIntents

/// Control Center toggle for LAN sharing (iOS 18+). Tapping it records the
/// desired state and opens the app, which actually starts/stops the on-device
/// HLS server (see `ToggleLANShareIntent` / `LANShareCoordinator`). The live
/// on/off is read from the App Group, mirrored by the app.
@available(iOS 18.0, *)
struct LANShareControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: WidgetShared.lanControlKind,
                                   provider: LANShareValueProvider()) { isOn in
            ControlWidgetToggle("Condivisione LAN",
                                isOn: isOn,
                                action: ToggleLANShareIntent()) { active in
                Label(active ? "LAN attiva" : "Condivisione LAN",
                      systemImage: active ? "antenna.radiowaves.left.and.right"
                                          : "antenna.radiowaves.left.and.right.slash")
            }
        }
        .displayName("Condivisione LAN")
        .description("Condividi i download sulla rete locale.")
    }
}

@available(iOS 18.0, *)
struct LANShareValueProvider: ControlValueProvider {
    var previewValue: Bool { false }
    func currentValue() async throws -> Bool { WidgetShared.lanActive() }
}
