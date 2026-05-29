import ActivityKit
import Foundation

/// Shared contract for the download Live Activity. Lives in `Streamo/Widget/`
/// alongside `WidgetSnapshot.swift` (so it compiles into the app target) and
/// is also added to the `StreamoWidgetExtension` target via a membership
/// exception in the Xcode project — same pattern as `WidgetSnapshot.swift`.
/// Both sides must see the identical type for ActivityKit to match the
/// running activity to its presentation.
///
/// Everything that changes during a download session — including the title,
/// because the active item changes as the queue drains — lives in
/// `ContentState`. `ActivityAttributes` itself is immutable, so keeping it
/// empty lets a single activity persist across the whole queue (we just
/// `update` its state) instead of being torn down and recreated per item.
struct DownloadActivityAttributes: ActivityAttributes {
    /// What the download session is doing right now. Drives the icon, colour
    /// and status text in the presentation.
    enum Phase: String, Codable, Hashable {
        case downloading
        case paused
        case failed
        case completed
    }

    struct ContentState: Codable, Hashable {
        /// Title of the item currently downloading (movie / show name).
        var title: String
        /// Secondary line for episodes, e.g. "S1 · E2 · Episode title". Nil
        /// for movies.
        var subtitle: String?
        /// Aggregate progress (0…1) across all active downloads — matches the
        /// in-app toolbar badge.
        var progress: Double
        /// Current phase (downloading / paused / failed / completed).
        var phase: Phase
        /// How many more items are still queued behind this one.
        var queuedCount: Int
    }
}
