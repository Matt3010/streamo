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
        static let foldersEnabled = "foldersEnabled"
        static let autoDeleteWatchedDownloads = "autoDeleteWatchedDownloads"
        static let accentR = "accentR"
        static let accentG = "accentG"
        static let accentB = "accentB"
        static let lanShareEnabled = "lanShareEnabled"
        static let lanToken = "lanToken"
        static let lanShareAutoOffMinutes = "lanShareAutoOffMinutes"
        static let lanShareDeadline = "lanShareDeadline"
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

    /// When true, the local HLS server accepts connections from non-loopback
    /// peers on the LAN. Authentication uses `lanToken` baked into the URL.
    var lanShareEnabled: Bool {
        didSet { defaults.set(lanShareEnabled, forKey: Keys.lanShareEnabled) }
    }

    /// Random secret embedded in shareable URLs. Generated on first use and
    /// persisted; rotated only via the Settings UI.
    var lanToken: String {
        didSet { defaults.set(lanToken, forKey: Keys.lanToken) }
    }

    /// Auto-shutoff window for LAN sharing in minutes — `0` disables the
    /// timer ("Mai" in the UI). The active deadline is persisted separately
    /// so app relaunches mid-window still honour the original cutoff.
    var lanShareAutoOffMinutes: Int {
        didSet { defaults.set(lanShareAutoOffMinutes, forKey: Keys.lanShareAutoOffMinutes) }
    }

    /// Absolute time at which LAN sharing should be auto-disabled. `nil`
    /// when no timer is pending. Persisted across launches so a deadline
    /// set with the app open still fires after the user closes it.
    var lanShareDeadline: Date? {
        didSet {
            if let lanShareDeadline {
                defaults.set(lanShareDeadline, forKey: Keys.lanShareDeadline)
            } else {
                defaults.removeObject(forKey: Keys.lanShareDeadline)
            }
        }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.tmdbApiKey = defaults.string(forKey: Keys.tmdbApiKey) ?? Self.defaultTmdbApiKey
        self.autoplayNext = defaults.object(forKey: Keys.autoplayNext) as? Bool ?? true
        self.providerLocale = defaults.string(forKey: Keys.providerLocale) ?? "it"
        self.foldersEnabled = defaults.object(forKey: Keys.foldersEnabled) as? Bool ?? true
        self.autoDeleteWatchedDownloads = defaults.object(forKey: Keys.autoDeleteWatchedDownloads) as? Bool ?? false
        self.accentR = defaults.object(forKey: Keys.accentR) as? Double ?? Self.defaultAccent.r
        self.accentG = defaults.object(forKey: Keys.accentG) as? Double ?? Self.defaultAccent.g
        self.accentB = defaults.object(forKey: Keys.accentB) as? Double ?? Self.defaultAccent.b
        self.lanShareEnabled = defaults.object(forKey: Keys.lanShareEnabled) as? Bool ?? false
        self.lanToken = defaults.string(forKey: Keys.lanToken) ?? Self.makeLANToken()
        self.lanShareAutoOffMinutes = defaults.object(forKey: Keys.lanShareAutoOffMinutes) as? Int ?? 0
        self.lanShareDeadline = defaults.object(forKey: Keys.lanShareDeadline) as? Date
    }

    /// 16-char URL-safe token (≈96 bits of entropy). Plenty for a LAN-only
    /// secret that the user can read off a Settings screen.
    static func makeLANToken() -> String {
        let chars = Array("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
        return String((0..<16).map { _ in chars.randomElement()! })
    }

    /// Rotate the token (used when the user wants to revoke existing shared
    /// links). The new value is persisted via `didSet`.
    func rotateLANToken() { lanToken = Self.makeLANToken() }

    var hasTmdbKey: Bool { !tmdbApiKey.trimmingCharacters(in: .whitespaces).isEmpty }
}
