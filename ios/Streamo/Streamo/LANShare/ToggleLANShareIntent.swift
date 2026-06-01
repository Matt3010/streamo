import AppIntents

/// App Intent backing the Control Center toggle for LAN sharing.
///
/// The HLS server runs inside the app process, so the intent itself can't
/// start it. Instead it records the desired state into the shared App Group
/// and opens the app (`openAppWhenRun`); `LANShareCoordinator` reads the
/// request on the next foreground and applies it, honouring the requirement
/// that a password be set before LAN access can be enabled.
///
/// This file is a member of BOTH targets (app + widget extension) — the
/// control references the type, and the app performs/handles it.
struct ToggleLANShareIntent: SetValueIntent {
    static let title: LocalizedStringResource = "Condivisione LAN"
    static var openAppWhenRun: Bool { true }

    @Parameter(title: "Attiva")
    var value: Bool

    init() {}
    init(value: Bool) { self.value = value }

    func perform() async throws -> some IntentResult {
        WidgetShared.setLANControlRequest(value)
        return .result()
    }
}
