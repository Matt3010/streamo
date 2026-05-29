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
/// ### Update cadence
/// ActivityKit rate-limits how often a Live Activity may be updated; flooding
/// it (e.g. one push per downloaded segment) makes the system *drop* updates,
/// so the bar lurches 40 → 49 instead of moving smoothly. Updates are therefore
/// funneled through a single serialized "pump": every call just records the
/// latest desired state, and one task applies the most recent state at a fixed
/// cadence (`minInterval`). This keeps us inside the budget, preserves order,
/// and lets the system animate the bar between steps.
///
/// All calls are no-ops when the user has Live Activities disabled.
@MainActor
final class DownloadActivityController {
    typealias Phase = DownloadActivityAttributes.Phase
    typealias State = DownloadActivityAttributes.ContentState

    private var activity: Activity<DownloadActivityAttributes>?
    /// Title / subtitle of the item currently shown, reused across updates.
    private var title = ""
    private var subtitle: String?

    /// Most recent state we want on screen; applied by the pump.
    private var pendingState: State?
    /// The serialized applier. Nil when idle.
    private var pumpTask: Task<Void, Never>?
    /// Minimum spacing between applied updates — ~2/sec stays well inside
    /// ActivityKit's budget while still looking live.
    private let minInterval: Duration = .milliseconds(500)

    /// Adopt an activity from a previous launch (call once at app start). Only
    /// adopt one that's still alive — an `.ended`/`.dismissed` activity (e.g. a
    /// "completed" frame mid dismissal) would silently swallow every future
    /// update, leaving the download running with a dead activity.
    func reconnect() {
        let live = Activity<DownloadActivityAttributes>.activities.filter {
            $0.activityState == .active || $0.activityState == .stale
        }
        activity = live.first
        if let state = live.first?.content.state {
            title = state.title
            subtitle = state.subtitle
        }
        for extra in live.dropFirst() {
            Task { await extra.end(nil, dismissalPolicy: .immediate) }
        }
    }

    /// Active download: set the item and push downloading state. Creates the
    /// activity if none exists, otherwise retargets the live one in place.
    func show(title: String, subtitle: String?, progress: Double, queuedCount: Int) {
        self.title = title
        self.subtitle = subtitle
        enqueue(progress: progress, phase: .downloading, queuedCount: queuedCount)
    }

    /// Progress tick for the current item. Cheap — just records the latest
    /// state; the pump applies it at cadence.
    func update(progress: Double, queuedCount: Int) {
        enqueue(progress: progress, phase: .downloading, queuedCount: queuedCount)
    }

    /// Manual pause: keep the activity visible in a paused state.
    func pause(title: String, subtitle: String?, progress: Double, queuedCount: Int) {
        self.title = title
        self.subtitle = subtitle
        enqueue(progress: progress, phase: .paused, queuedCount: queuedCount)
    }

    /// A download failed and nothing else is running: show a warning that
    /// stays on screen so the user notices something went wrong.
    func fail(title: String, subtitle: String?, progress: Double) {
        self.title = title
        self.subtitle = subtitle
        enqueue(progress: progress, phase: .failed, queuedCount: 0)
    }

    private func enqueue(progress: Double, phase: Phase, queuedCount: Int) {
        let state = State(title: title, subtitle: subtitle, progress: progress,
                          phase: phase, queuedCount: queuedCount)
        guard let activity else {
            create(initial: state)
            return
        }
        pendingState = state
        startPumpIfIdle(activity)
    }

    private func create(initial state: State) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        do {
            activity = try Activity.request(
                attributes: DownloadActivityAttributes(),
                content: ActivityContent(state: state, staleDate: nil),
                pushType: nil
            )
        } catch {
            NSLog("[DownloadActivity] start failed: %@", error.localizedDescription)
        }
    }

    /// Apply the latest pending state immediately, then keep applying the most
    /// recent state every `minInterval` until nothing new arrives.
    private func startPumpIfIdle(_ activity: Activity<DownloadActivityAttributes>) {
        guard pumpTask == nil else { return }
        pumpTask = Task { [weak self] in
            while let self, let state = self.consumePending() {
                await activity.update(ActivityContent(state: state, staleDate: nil))
                try? await Task.sleep(for: self.minInterval)
            }
            self?.pumpTask = nil
        }
    }

    private func consumePending() -> State? {
        defer { pendingState = nil }
        return pendingState
    }

    /// Whole queue finished: brief "completed" frame, then dismiss.
    func finish() {
        guard let activity else { return }
        stopPump()
        self.activity = nil
        let state = State(title: title, subtitle: subtitle, progress: 1,
                          phase: .completed, queuedCount: 0)
        Task {
            await activity.end(ActivityContent(state: state, staleDate: nil),
                               dismissalPolicy: .after(.now + 4))
        }
    }

    /// Tear the activity down right away (cancel-all / playback / nothing to
    /// show).
    func endImmediately() {
        guard let activity else { return }
        stopPump()
        self.activity = nil
        Task { await activity.end(nil, dismissalPolicy: .immediate) }
    }

    private func stopPump() {
        pumpTask?.cancel()
        pumpTask = nil
        pendingState = nil
    }
}
