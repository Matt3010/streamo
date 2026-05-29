import Foundation
import ActivityKit

/// Thin wrapper around the download Live Activity. `DownloadManager` drives it:
/// `start` when an item begins downloading, `update` as progress / queue
/// changes, `end` when the queue drains (or the user cancels everything).
///
/// All calls are no-ops when the user has Live Activities disabled, so the
/// caller never has to guard.
@MainActor
final class DownloadActivityController {
    private var activity: Activity<DownloadActivityAttributes>?
    /// Progress we last pushed, so `update` can throttle ActivityKit traffic.
    private var lastPushedProgress: Double = -1

    /// Start (or re-target) the activity for a newly-active download. If one is
    /// already live we just retarget it to the new item via `update` rather
    /// than spawning a second activity.
    func start(title: String, subtitle: String?, progress: Double, queuedCount: Int) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }

        let state = DownloadActivityAttributes.ContentState(
            progress: progress,
            statusLabel: "Download in corso",
            queuedCount: queuedCount,
            isFinished: false
        )

        // If a live activity already exists but for a different title, end it
        // and open a fresh one so the lock-screen title matches the new item.
        if let activity, activity.attributes.title == title, activity.attributes.subtitle == subtitle {
            Task { await activity.update(ActivityContent(state: state, staleDate: nil)) }
            lastPushedProgress = progress
            return
        }
        endImmediately()

        let attributes = DownloadActivityAttributes(title: title, subtitle: subtitle)
        do {
            activity = try Activity.request(
                attributes: attributes,
                content: ActivityContent(state: state, staleDate: nil),
                pushType: nil
            )
            lastPushedProgress = progress
        } catch {
            NSLog("[DownloadActivity] start failed: %@", error.localizedDescription)
        }
    }

    /// Push a progress / queue update. Throttled: skips sub-2% deltas so we
    /// stay well inside ActivityKit's per-app update budget. Pass `force` for
    /// state transitions (status label / queue count changes) that must show.
    func update(progress: Double, statusLabel: String = "Download in corso",
                queuedCount: Int, force: Bool = false) {
        guard let activity else { return }
        guard force || progress >= lastPushedProgress + 0.02 || progress >= 0.999 else { return }
        lastPushedProgress = progress
        let state = DownloadActivityAttributes.ContentState(
            progress: progress,
            statusLabel: statusLabel,
            queuedCount: queuedCount,
            isFinished: false
        )
        Task { await activity.update(ActivityContent(state: state, staleDate: nil)) }
    }

    /// Show a brief "completed" frame, then dismiss. Used when the whole queue
    /// finishes successfully.
    func finish() {
        guard let activity else { return }
        self.activity = nil
        lastPushedProgress = -1
        let state = DownloadActivityAttributes.ContentState(
            progress: 1,
            statusLabel: "Download completato",
            queuedCount: 0,
            isFinished: true
        )
        Task {
            await activity.end(ActivityContent(state: state, staleDate: nil),
                               dismissalPolicy: .after(.now + 4))
        }
    }

    /// Tear the activity down right away (cancel-all / nothing left to show).
    func endImmediately() {
        guard let activity else { return }
        self.activity = nil
        lastPushedProgress = -1
        Task { await activity.end(nil, dismissalPolicy: .immediate) }
    }
}
