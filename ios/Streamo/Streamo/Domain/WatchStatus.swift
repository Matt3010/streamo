import Foundation

/// "What's my status with this title" copy — port of the web `watch-status.ts`
/// (formatTvStatusText / formatTvCaughtUpText / formatMovieRemaining).
enum WatchStatus {
    // MARK: - Status cycling (port of watchlist-status.util.ts)

    /// Next status when the toggle button is tapped, and whether it needs a
    /// confirmation ("Segna come visto"). Cycle: todo → in_progress → done → todo.
    static func statusTransition(_ current: WatchlistStatus) -> (next: WatchlistStatus, requiresConfirm: Bool) {
        switch current {
        case .done: return (.todo, false)
        case .inProgress: return (.done, true)
        case .todo: return (.inProgress, false)
        }
    }

    /// SF Symbol for the status toggle button, by current status.
    static func statusIcon(_ status: WatchlistStatus) -> String {
        switch status {
        case .done: return "arrow.uturn.backward"
        case .inProgress: return "checkmark"
        case .todo: return "play.fill"
        }
    }

    static func statusToast(_ title: String, _ newStatus: WatchlistStatus) -> String {
        switch newStatus {
        case .todo: return "\(title): rimesso in \"Da guardare\""
        case .inProgress: return "\(title): spostato in \"In corso\""
        case .done: return "\(title): segnato come visto"
        }
    }

    /// Movie "Mancano N min" / "Manca 1 min" / "Mancano X h Y min" remaining
    /// copy. Returns nil when not started or already finished.
    static func movieRemainingText(position: Double?, duration: Double?) -> String? {
        let pos = position ?? 0
        let dur = duration ?? 0
        if dur <= 0 || pos <= 0 || pos >= dur { return nil }

        let remainingMinutes = Int(((dur - pos) / 60).rounded(.up))
        if remainingMinutes <= 0 { return nil }
        if remainingMinutes < 60 {
            return remainingMinutes == 1 ? "Manca 1 min" : "Mancano \(remainingMinutes) min"
        }
        let hours = remainingMinutes / 60
        let minutes = remainingMinutes % 60
        let timeLeft = minutes > 0 ? "\(hours) h \(minutes) min" : "\(hours) h"
        return (hours == 1 && minutes == 0) ? "Manca \(timeLeft)" : "Mancano \(timeLeft)"
    }
}
