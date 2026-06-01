import Foundation
import Observation
import WidgetKit

/// Single point of truth for turning LAN sharing on and off. Mutates
/// `AppSettings.lanShareEnabled`, pushes config to `LocalHLSServer`, drives
/// the silent-audio keep-alive, and arms the auto-shutoff deadline. Settings
/// UI and `LANAutoShutoff` both go through here so the side effects fire
/// from every entry point.
@MainActor
enum LANShareCoordinator {
    static func setEnabled(_ enabled: Bool) {
        let s = AppSettings.shared
        // Safety: never enable LAN sharing without a password.
        let enabled = enabled && !s.lanPassword.isEmpty
        s.lanShareEnabled = enabled
        LocalHLSServer.shared.setLANConfig(enabled: enabled, token: s.lanToken, password: s.lanPassword)
        if enabled {
            Task { _ = try? await LocalHLSServer.shared.ensureRunning() }
            BackgroundKeepAlive.shared.start()
            applyAutoOff()
        } else {
            BackgroundKeepAlive.shared.stop()
            s.lanShareDeadline = nil
        }
        LANAutoShutoff.shared.reschedule()
        syncControlState()
    }

    /// Apply a pending Control Center toggle (if any) and refresh the control's
    /// displayed state. Called at launch and whenever the app becomes active —
    /// this is how the out-of-process Control Center toggle actually starts or
    /// stops the in-app server.
    static func applyPendingControlRequest() {
        let s = AppSettings.shared
        if let requested = WidgetShared.takeLANControlRequest() {
            if requested && s.lanPassword.isEmpty {
                // Control Center can't prompt for a password, so we can only
                // enable once one exists. Point the user at Settings.
                ToastCenter.shared.show("Imposta una password per la Condivisione LAN nelle Impostazioni")
            } else if requested != s.lanShareEnabled {
                setEnabled(requested)   // mirrors the control state itself
            }
        }
        syncControlState()
    }

    /// Mirror the live LAN state into the App Group and ask Control Center to
    /// redraw the toggle so it matches what the app is actually doing.
    static func syncControlState() {
        WidgetShared.setLANActive(AppSettings.shared.lanShareEnabled)
        if #available(iOS 18.0, *) {
            ControlCenter.shared.reloadControls(ofKind: WidgetShared.lanControlKind)
        }
    }

    /// Called after the user changes `lanShareAutoOffMinutes` (Picker in
    /// Settings). Re-bases the deadline from "now" so the chosen duration is
    /// always the time remaining from the moment the user picked it.
    static func applyAutoOff() {
        let s = AppSettings.shared
        guard s.lanShareEnabled else {
            s.lanShareDeadline = nil
            LANAutoShutoff.shared.reschedule()
            return
        }
        if s.lanShareAutoOffMinutes > 0 {
            s.lanShareDeadline = Date().addingTimeInterval(TimeInterval(s.lanShareAutoOffMinutes * 60))
        } else {
            s.lanShareDeadline = nil
        }
        LANAutoShutoff.shared.reschedule()
    }
}

/// Holds the live Task that disables LAN sharing when its deadline fires.
/// Re-armed by `LANShareCoordinator` and at app launch (so a deadline set
/// in a previous session is honoured even if the user killed the app mid-
/// window — provided the app is launched before the deadline elapses, or
/// after, in which case we disable on the spot).
@MainActor
@Observable
final class LANAutoShutoff {
    static let shared = LANAutoShutoff()

    private(set) var deadline: Date?
    private var task: Task<Void, Never>?

    private init() {}

    func reschedule() {
        task?.cancel()
        task = nil
        let s = AppSettings.shared
        guard s.lanShareEnabled, let target = s.lanShareDeadline, s.lanShareAutoOffMinutes > 0 else {
            deadline = nil
            return
        }
        let now = Date()
        if target <= now {
            // Deadline already passed (probably because the app was closed
            // through the cutoff). Disable now instead of waiting.
            deadline = nil
            LANShareCoordinator.setEnabled(false)
            return
        }
        deadline = target
        let delay = target.timeIntervalSince(now)
        task = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            if Task.isCancelled { return }
            guard let self else { return }
            await MainActor.run {
                // Re-check: the user may have flipped LAN off manually while
                // we were sleeping, in which case the task is moot.
                if AppSettings.shared.lanShareEnabled, AppSettings.shared.lanShareDeadline == target {
                    LANShareCoordinator.setEnabled(false)
                    ToastCenter.shared.show("Condivisione LAN disattivata")
                }
                self.deadline = nil
            }
        }
    }
}
