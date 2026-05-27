import Foundation

enum Format {
    /// "h:mm:ss" (or "m:ss" under an hour) — port of the web `formatTime`.
    static func time(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds > 0 else { return "0:00" }
        let total = Int(seconds.rounded())
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        if h > 0 { return String(format: "%d:%02d:%02d", h, m, s) }
        return String(format: "%d:%02d", m, s)
    }

    /// Progress percentage 0...100 for a position/duration pair.
    static func percent(position: Double, duration: Double) -> Double {
        guard duration > 0 else { return 0 }
        return min(100, max(0, position / duration * 100))
    }

    /// "Visto 1 min" / "Visti N min" — port of the web `formatViewedMinutes`
    /// (history card red line for a not-yet-completed item). nil if not started.
    static func viewedMinutes(_ position: Double?) -> String? {
        guard let position, position > 0 else { return nil }
        let minutes = max(1, Int(position / 60))
        return minutes == 1 ? "Visto 1 min" : "Visti \(minutes) min"
    }

    /// Human watch-time, e.g. "12 h 30 min" / "45 min" / "0 min".
    static func watchTime(_ seconds: Double) -> String {
        let totalMin = Int(seconds / 60)
        let h = totalMin / 60, m = totalMin % 60
        if h > 0 { return m > 0 ? "\(h) h \(m) min" : "\(h) h" }
        return "\(m) min"
    }
}
