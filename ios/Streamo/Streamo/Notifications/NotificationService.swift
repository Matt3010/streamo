import Foundation
import UserNotifications

/// Local notifications: new-episode alerts for watchlist TV titles + resume
/// reminders. Replaces the web app's FCM push.
///
/// NOTE: detection runs in the foreground (on app activation), not via a true
/// background task — BGTaskScheduler needs extra Info.plist identifiers and a
/// capability, and fires unpredictably. New episodes are surfaced the next time
/// the app is opened; resume reminders are real scheduled notifications that
/// fire on time regardless.
@MainActor
final class NotificationService {
    static let shared = NotificationService()

    private var lastRefresh: Date?
    private let resumeDelayDays = 7.0   // web idle floor before nudging
    private let refreshThrottle: TimeInterval = 15 * 60

    private init() {}

    /// Ask for permission if not yet decided. Returns whether we're authorized.
    @discardableResult
    func requestAuthorizationIfNeeded() async -> Bool {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .notDetermined:
            return (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        case .authorized, .provisional, .ephemeral:
            return true
        default:
            return false
        }
    }

    /// Foreground refresh — throttled. Detects new episodes and reschedules
    /// resume reminders.
    func refresh(library: Library) async {
        guard AppSettings.shared.notificationsEnabled else { return }
        if let last = lastRefresh, Date().timeIntervalSince(last) < refreshThrottle { return }
        lastRefresh = Date()
        guard await requestAuthorizationIfNeeded() else { return }
        if AppSettings.shared.notifyNewEpisodes || AppSettings.shared.notifyNewSeason {
            await checkNewEpisodes(library: library)
        }
        if AppSettings.shared.notifyResumeReminder { scheduleResumeReminders(library: library) }
    }

    // MARK: - New episodes

    private func checkNewEpisodes(library: Library) async {
        for entry in library.watchlist() where entry.mediaType == .tv {
            guard let item = try? await TMDBClient.shared.details(id: entry.tmdbId, type: .tv) else { continue }
            let aired = TVLogic.airedEpisodesCount(item)
            let latest = TVLogic.effectiveLastEpisode(item)
            let season = latest?.season ?? 0
            let episode = latest?.episode ?? 0
            // Always refresh the baseline at the end, even on the early-outs.
            defer { library.setLastKnownAired(entry.tmdbId, .tv, count: aired, season: season) }

            // First time we see this title: just record the baseline, no alert.
            guard let knownCount = entry.lastKnownAiredEpisodes, aired > knownCount else { continue }

            // Only engaged watchers — in_progress, or a "done" show that just got
            // content beyond its completion mark (reopen). Skip "todo" (web parity).
            let isReopen = entry.status == .done && aired > (entry.doneAiredEpisodes ?? 0)
            guard entry.status == .inProgress || isReopen else { continue }

            let title = entry.title ?? item.displayTitle
            let isNewSeason = season > (entry.lastKnownAiredSeason ?? 0)
            if isNewSeason {
                guard AppSettings.shared.notifyNewSeason else { continue }
                post(id: "new-season-tv-\(entry.tmdbId)", title: "Nuova stagione",
                     body: "\(title): nuova stagione disponibile (S\(season))",
                     userInfo: ["tmdbId": entry.tmdbId, "mediaType": "tv", "season": season])
            } else {
                guard AppSettings.shared.notifyNewEpisodes else { continue }
                let delta = aired - knownCount
                let body = delta > 1
                    ? "\(title): \(delta) nuovi episodi"
                    : "\(title): nuovo episodio S\(season) E\(episode)"
                post(id: "new-episode-tv-\(entry.tmdbId)", title: "Nuovo episodio", body: body,
                     userInfo: ["tmdbId": entry.tmdbId, "mediaType": "tv", "season": season, "episode": episode])
            }
        }
    }

    // MARK: - Series completed

    /// Phrase pool for the "series finished" body — port of the web
    /// SERIES_COMPLETED_PHRASES, picked deterministically per title.
    private static let seriesCompletedPhrases = [
        "Hai finito tutti gli episodi", "Serie completata", "Capitolo chiuso",
        "Maratona conclusa", "Tutto visto, complimenti", "Hai chiuso il cerchio",
        "Fine corsa", "Visto fino all'ultimo episodio",
    ]

    /// Fired once when a series auto-flips to "done" (port of the web
    /// `series_completed`). Fire-and-forget; the system drops it if we're not
    /// authorized. Only the status transition reaches here, so it won't spam.
    func notifySeriesCompleted(tmdbId: Int, title: String?) {
        guard AppSettings.shared.notificationsEnabled else { return }
        let phrase = Self.seriesCompletedPhrases[abs(tmdbId) % Self.seriesCompletedPhrases.count]
        post(
            id: "series-completed-tv-\(tmdbId)",
            title: title ?? "Serie completata",
            body: phrase,
            userInfo: ["tmdbId": tmdbId, "mediaType": "tv"]
        )
    }

    // MARK: - Resume reminders

    private func scheduleResumeReminders(library: Library) {
        let center = UNUserNotificationCenter.current()
        for entry in library.continueWatching() {
            // Web: only "in_progress" watchlist shows, stalled mid-watch
            // (5%–95%), nudged once 7 days after the last activity.
            guard library.watchlistStatus(entry.tmdbId, entry.mediaType) == .inProgress,
                  entry.duration > 0 else { continue }
            let fraction = entry.position / entry.duration
            guard fraction >= 0.05, fraction <= 0.95 else { continue }
            let fireDate = entry.updatedAt.addingTimeInterval(resumeDelayDays * 86_400)
            guard fireDate > Date() else { continue }
            let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: fireDate)
            let content = UNMutableNotificationContent()
            content.title = "Riprendi a guardare"
            content.body = entry.title ?? "Hai un titolo in sospeso"
            content.sound = .default
            content.userInfo = ["tmdbId": entry.tmdbId, "mediaType": entry.mediaTypeRaw,
                                "season": entry.season, "episode": entry.episode]
            let request = UNNotificationRequest(
                identifier: "resume-\(entry.mediaTypeRaw)-\(entry.tmdbId)",
                content: content,
                trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
            )
            center.add(request)
        }
    }

    // MARK: - Helpers

    private func post(id: String, title: String, body: String, userInfo: [AnyHashable: Any] = [:]) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.userInfo = userInfo
        let request = UNNotificationRequest(
            identifier: id, content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
        )
        UNUserNotificationCenter.current().add(request)
    }
}

/// Handles notification taps → deep links into the title, and shows banners
/// while the app is foregrounded.
final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationDelegate()

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification) async
        -> UNNotificationPresentationOptions { [.banner, .sound] }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        guard let id = info["tmdbId"] as? Int,
              let typeRaw = info["mediaType"] as? String,
              let type = MediaType(rawValue: typeRaw) else { return }
        let season = info["season"] as? Int ?? 0
        let episode = info["episode"] as? Int ?? 0
        await MainActor.run {
            AppNavigation.shared.open(MediaRef(tmdbId: id, mediaType: type, resumeSeason: season, resumeEpisode: episode))
        }
    }
}
