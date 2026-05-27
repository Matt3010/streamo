import Foundation
import Observation

/// App-wide settings, persisted in UserDefaults. Single-user, on-device —
/// replaces the web app's per-user account row.
///
/// The TMDB API key defaults to the value from the web project's `.env`
/// (`TMDB_API_KEY`) for convenience; it's overridable in the Settings screen.
@Observable
final class AppSettings {
    static let shared = AppSettings()

    private enum Keys {
        static let tmdbApiKey = "tmdbApiKey"
        static let autoplayNext = "autoplayNext"
        static let providerLocale = "providerLocale"
        static let notificationsEnabled = "notificationsEnabled"
        static let notifyNewEpisodes = "notifyNewEpisodes"
        static let notifyNewSeason = "notifyNewSeason"
        static let notifyResumeReminder = "notifyResumeReminder"
        static let foldersEnabled = "foldersEnabled"
        static let autoDeleteWatchedDownloads = "autoDeleteWatchedDownloads"
        static let accentR = "accentR"
        static let accentG = "accentG"
        static let accentB = "accentB"
    }

    /// Default accent — the web brand red #E50914.
    static let defaultAccent = (r: 0.898, g: 0.035, b: 0.078)

    /// Default baked from the existing web `.env`. Overridable in Settings.
    static let defaultTmdbApiKey = "42b62dc72918b626d8ea3e33c35e16a6"

    private let defaults: UserDefaults

    var tmdbApiKey: String {
        didSet { defaults.set(tmdbApiKey, forKey: Keys.tmdbApiKey) }
    }

    var autoplayNext: Bool {
        didSet { defaults.set(autoplayNext, forKey: Keys.autoplayNext) }
    }

    /// Provider catalog locale (streamingcommunity path segment). Defaults to
    /// 'it' as in the web `PROVIDER_CATALOG_LOCALE`.
    var providerLocale: String {
        didSet { defaults.set(providerLocale, forKey: Keys.providerLocale) }
    }

    /// Master switch for local notifications. The two sub-toggles below only
    /// take effect when this is on.
    var notificationsEnabled: Bool {
        didSet { defaults.set(notificationsEnabled, forKey: Keys.notificationsEnabled) }
    }
    var notifyNewEpisodes: Bool {
        didSet { defaults.set(notifyNewEpisodes, forKey: Keys.notifyNewEpisodes) }
    }
    var notifyNewSeason: Bool {
        didSet { defaults.set(notifyNewSeason, forKey: Keys.notifyNewSeason) }
    }
    var notifyResumeReminder: Bool {
        didSet { defaults.set(notifyResumeReminder, forKey: Keys.notifyResumeReminder) }
    }

    /// Whether the watchlist groups titles into folders.
    var foldersEnabled: Bool {
        didSet { defaults.set(foldersEnabled, forKey: Keys.foldersEnabled) }
    }

    /// Auto-delete a downloaded title once it's been watched (≥90%).
    var autoDeleteWatchedDownloads: Bool {
        didSet { defaults.set(autoDeleteWatchedDownloads, forKey: Keys.autoDeleteWatchedDownloads) }
    }

    /// User-chosen accent colour, stored as RGB components (0…1). `Theme.red`
    /// reads these, so changing them re-tints the whole app.
    var accentR: Double { didSet { defaults.set(accentR, forKey: Keys.accentR) } }
    var accentG: Double { didSet { defaults.set(accentG, forKey: Keys.accentG) } }
    var accentB: Double { didSet { defaults.set(accentB, forKey: Keys.accentB) } }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.tmdbApiKey = defaults.string(forKey: Keys.tmdbApiKey) ?? Self.defaultTmdbApiKey
        self.autoplayNext = defaults.object(forKey: Keys.autoplayNext) as? Bool ?? true
        self.providerLocale = defaults.string(forKey: Keys.providerLocale) ?? "it"
        self.notificationsEnabled = defaults.object(forKey: Keys.notificationsEnabled) as? Bool ?? false
        self.notifyNewEpisodes = defaults.object(forKey: Keys.notifyNewEpisodes) as? Bool ?? true
        self.notifyNewSeason = defaults.object(forKey: Keys.notifyNewSeason) as? Bool ?? true
        self.notifyResumeReminder = defaults.object(forKey: Keys.notifyResumeReminder) as? Bool ?? true
        self.foldersEnabled = defaults.object(forKey: Keys.foldersEnabled) as? Bool ?? true
        self.autoDeleteWatchedDownloads = defaults.object(forKey: Keys.autoDeleteWatchedDownloads) as? Bool ?? false
        self.accentR = defaults.object(forKey: Keys.accentR) as? Double ?? Self.defaultAccent.r
        self.accentG = defaults.object(forKey: Keys.accentG) as? Double ?? Self.defaultAccent.g
        self.accentB = defaults.object(forKey: Keys.accentB) as? Double ?? Self.defaultAccent.b
    }

    var hasTmdbKey: Bool { !tmdbApiKey.trimmingCharacters(in: .whitespaces).isEmpty }
}
