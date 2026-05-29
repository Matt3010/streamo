import ActivityKit
import Foundation

/// Shared contract for the download Live Activity. Lives in `Streamo/Widget/`
/// alongside `WidgetSnapshot.swift` (so it compiles into the app target) and
/// is also added to the `StreamoWidgetExtension` target via a membership
/// exception in the Xcode project — same pattern as `WidgetSnapshot.swift`.
/// Both sides must see the identical type for ActivityKit to match the
/// running activity to its presentation.
struct DownloadActivityAttributes: ActivityAttributes {
    /// Mutable per-update state pushed from the app while a download runs.
    struct ContentState: Codable, Hashable {
        /// 0…1 progress of the item currently downloading.
        var progress: Double
        /// Short status line, e.g. "Download in corso" / "In coda".
        var statusLabel: String
        /// How many more items are still queued behind this one.
        var queuedCount: Int
        /// True once the whole queue finished (drives the final frame).
        var isFinished: Bool
    }

    /// Title of the item currently downloading (movie / show name).
    var title: String
    /// Secondary line for episodes, e.g. "S1 · E2 · Episode title". Nil for
    /// movies.
    var subtitle: String?
}