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
        static let animeUnityBaseURL = "animeUnityBaseURL"
        static let warpEnabled = "warpEnabled"
        static let warpRegistered = "warpRegistered"
        static let autoDeleteWatchedDownloads = "autoDeleteWatchedDownloads"
        static let showCardInfo = "showCardInfo"
        static let streamingMaxHeight = "streamingMaxHeight"
        static let downloadMaxHeight = "downloadMaxHeight"
        static let accentR = "accentR"
        static let accentG = "accentG"
        static let accentB = "accentB"
        static let lanShareEnabled = "lanShareEnabled"
        static let lanToken = "lanToken"
        static let lanPassword = "lanPassword"
        static let lanShareAutoOffMinutes = "lanShareAutoOffMinutes"
        static let lanShareDeadline = "lanShareDeadline"
    }

    /// Default accent — the web brand red #E50914.
    static let defaultAccent = (r: 0.898, g: 0.035, b: 0.078)

    /// Default baked from the existing web `.env`. Overridable in Settings.
    static let defaultTmdbApiKey = "42b62dc72918b626d8ea3e33c35e16a6"

    /// AnimeUnity catalog host (no trailing slash). The domain rotates; this is
    /// the current primary, overridable from Advanced settings if it moves.
    static let defaultAnimeUnityBaseURL = "https://www.animeunity.so"

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

    /// AnimeUnity catalog host (no trailing slash). Overridable in Advanced
    /// settings when AnimeUnity rotates its domain.
    var animeUnityBaseURL: String {
        didSet { defaults.set(animeUnityBaseURL, forKey: Keys.animeUnityBaseURL) }
    }

    /// User-facing master switch for on-device WARP egress. When on (and an
    /// account is registered), provider/scrape traffic and playback flow
    /// through the in-process WireGuard tunnel (`WarpTunnel`) + on-device proxy,
    /// hiding the device IP. When off, requests go straight from the device IP.
    var warpEnabled: Bool {
        didSet { defaults.set(warpEnabled, forKey: Keys.warpEnabled) }
    }

    /// Whether a free Cloudflare WARP account has been registered on this
    /// device (`WarpAccount`, stored in the Keychain). Kept in sync by the
    /// Settings screen; gates `providerProxyActive`.
    var warpRegistered: Bool {
        didSet { defaults.set(warpRegistered, forKey: Keys.warpRegistered) }
    }

    /// Auto-delete a downloaded title once it's been watched (≥90%).
    var autoDeleteWatchedDownloads: Bool {
        didSet { defaults.set(autoDeleteWatchedDownloads, forKey: Keys.autoDeleteWatchedDownloads) }
    }

    /// Show title / year / rating text over the poster cards. When off the
    /// cards are clean posters — except "Continua a guardare", which always
    /// keeps its full info and progress.
    var showCardInfo: Bool {
        didSet { defaults.set(showCardInfo, forKey: Keys.showCardInfo) }
    }

    /// Max vertical resolution for STREAMING. 0 = Auto (HLS adaptive). When set
    /// (e.g. 720), the player caps variant selection at that height.
    var streamingMaxHeight: Int {
        didSet { defaults.set(streamingMaxHeight, forKey: Keys.streamingMaxHeight) }
    }

    /// Vertical resolution kept for DOWNLOADS (no "auto" — a download picks one
    /// variant). The downloader keeps the highest variant ≤ this height.
    var downloadMaxHeight: Int {
        didSet { defaults.set(downloadMaxHeight, forKey: Keys.downloadMaxHeight) }
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

    /// Required password for LAN access (HTTP Basic Auth). LAN sharing can't be
    /// enabled until this is set.
    var lanPassword: String {
        didSet { defaults.set(lanPassword, forKey: Keys.lanPassword) }
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
        self.animeUnityBaseURL = defaults.string(forKey: Keys.animeUnityBaseURL) ?? Self.defaultAnimeUnityBaseURL
        self.warpEnabled = defaults.object(forKey: Keys.warpEnabled) as? Bool ?? false
        self.warpRegistered = defaults.object(forKey: Keys.warpRegistered) as? Bool ?? false
        self.autoDeleteWatchedDownloads = defaults.object(forKey: Keys.autoDeleteWatchedDownloads) as? Bool ?? false
        self.showCardInfo = defaults.object(forKey: Keys.showCardInfo) as? Bool ?? true
        self.streamingMaxHeight = defaults.object(forKey: Keys.streamingMaxHeight) as? Int ?? 0       // Auto
        self.downloadMaxHeight = defaults.object(forKey: Keys.downloadMaxHeight) as? Int ?? 1080
        self.accentR = defaults.object(forKey: Keys.accentR) as? Double ?? Self.defaultAccent.r
        self.accentG = defaults.object(forKey: Keys.accentG) as? Double ?? Self.defaultAccent.g
        self.accentB = defaults.object(forKey: Keys.accentB) as? Double ?? Self.defaultAccent.b
        self.lanShareEnabled = defaults.object(forKey: Keys.lanShareEnabled) as? Bool ?? false
        self.lanToken = defaults.string(forKey: Keys.lanToken) ?? Self.makeLANToken()
        self.lanPassword = defaults.string(forKey: Keys.lanPassword) ?? ""
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
    /// Proxy (WARP) mode is active when the user enabled it and an account is
    /// registered. The tunnel itself is started lazily by `ProviderResolver`;
    /// if it fails to come up, resolution falls back to the direct path.
    var providerProxyActive: Bool { warpEnabled && warpRegistered }
}
