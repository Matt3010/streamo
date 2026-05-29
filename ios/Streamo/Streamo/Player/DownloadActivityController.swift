import Foundation
import ActivityKit

/// Owns the single download Live Activity for the whole queue. `DownloadManager`
/// drives it through explicit phase calls: `show` (downloading), `update`
/// (progress), `pause`, `fail`, `finish`, `endImmediately`.
///
/// A single activity persists across the entire session — the title lives in
/// `ContentState`, so switching items is just an update, never a teardown.
/// `reconnect()` adopts an activity left over from a previous app launch so we
/// never stack a stale duplicate on the lock screen.
///
/// Paused and failed downloads keep the activity on screen (the user asked to
/// still see a paused download, and to get a warning when something breaks);
/// only `finish`/`endImmediately` remove it.
///
/// All calls are no-ops when the user has Live Activities disabled, so the
/// caller never has to guard.
@MainActor
final class DownloadActivityController {
    typealias Phase = DownloadActivityAttributes.Phase

    private var activity: Activity<DownloadActivityAttributes>?
    /// Progress we last pushed, so `update` can throttle ActivityKit traffic.
    private var lastPushedProgress: Double = -1
    /// Last phase pushed — a phase change always bypasses the progress throttle.
    private var lastPhase: Phase?
    /// Title / subtitle of the item currently shown, reused across updates.
    private var title = ""
    private var subtitle: String?

    /// Adopt an activity from a previous launch (call once at app start). The
    /// new process gets no reference automatically, so without this an old
    /// activity lingers on the lock screen, never updates, and a fresh `show`
    /// would create a second one beside it. We keep the most recent and end
    /// extras.
    func reconnect() {
        let existing = Activity<DownloadActivityAttributes>.activities
        activity = existing.first
        lastPushedProgress = -1
        lastPhase = existing.first?.content.state.phase
        if let state = existing.first?.content.state {
            title = state.title
            subtitle = state.subtitle
        }
        for extra in existing.dropFirst() {
            Task { await extra.end(nil, dismissalPolicy: .immediate) }
        }
    }

    /// Active download: set the item and push downloading state. Creates the
    /// activity if none exists, otherwise retargets the live one in place.
    func show(title: String, subtitle: String?, progress: Double, queuedCount: Int) {
        self.title = title
        self.subtitle = subtitle
        render(progress: progress, phase: .downloading, queuedCount: queuedCount, force: true)
    }

    /// Progress tick for the current item. Throttled to ~1% steps (absolute,
    /// so a drop when a new item is enqueued still shows). Pass `force` for
    /// queue changes that must show immediately.
    func update(progress: Double, queuedCount: Int, force: Bool = false) {
        render(progress: progress, phase: .downloading, queuedCount: queuedCount, force: force)
    }

    /// Manual pause: keep the activity visible in a paused state.
    func pause(title: String, subtitle: String?, progress: Double, queuedCount: Int) {
        self.title = title
        self.subtitle = subtitle
        render(progress: progress, phase: .paused, queuedCount: queuedCount, force: true)
    }

    /// A download failed and nothing else is running: show a warning that
    /// stays on screen so the user notices something went wrong.
    func fail(title: String, subtitle: String?, progress: Double) {
        self.title = title
        self.subtitle = subtitle
        render(progress: progress, phase: .failed, queuedCount: 0, force: true)
    }

    private func render(progress: Double, phase: Phase, queuedCount: Int, force: Bool) {
        let state = DownloadActivityAttributes.ContentState(
            title: title,
            subtitle: subtitle,
            progress: progress,
            phase: phase,
            queuedCount: queuedCount
        )
        if let activity {
            let phaseChanged = lastPhase != phase
            guard force || phaseChanged
                    || abs(progress - lastPushedProgress) >= 0.01
                    || progress >= 0.999 else { return }
            lastPushedProgress = progress
            lastPhase = phase
            Task { await activity.update(ActivityContent(state: state, staleDate: nil)) }
        } else {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
            do {
                activity = try Activity.request(
                    attributes: DownloadActivityAttributes(),
                    content: ActivityContent(state: state, staleDate: nil),
                    pushType: nil
                )
                lastPushedProgress = progress
                lastPhase = phase
            } catch {
                NSLog("[DownloadActivity] start failed: %@", error.localizedDescription)
            }
        }
    }

    /// Whole queue finished: brief "completed" frame, then dismiss.
    func finish() {
        guard let activity else { return }
        self.activity = nil
        lastPushedProgress = -1
        lastPhase = nil
        let state = DownloadActivityAttributes.ContentState(
            title: title,
            subtitle: subtitle,
            progress: 1,
            phase: .completed,
            queuedCount: 0
        )
        Task {
            await activity.end(ActivityContent(state: state, staleDate: nil),
                               dismissalPolicy: .after(.now + 4))
        }
    }

    /// Tear the activity down right away (cancel-all / playback / nothing to
    /// show).
    func endImmediately() {
        guard let activity else { return }
        self.activity = nil
        lastPushedProgress = -1
        lastPhase = nil
        Task { await activity.end(nil, dismissalPolicy: .immediate) }
    }
}
