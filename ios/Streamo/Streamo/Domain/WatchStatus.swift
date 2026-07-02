import Foundation

/// "What's my status with this title" copy — port of the web `watch-status.ts`
/// (formatMovieRemaining).
enum WatchStatus {
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
