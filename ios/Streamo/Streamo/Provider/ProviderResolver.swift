import Foundation

/// Identifies what a request is for. Originally sent to the remote proxy as
/// `X-Streamo-Client`; with the proxy now on-device it tags the live-proxy
/// `c=` query param so the server log can tell downloads, streaming and
/// catalog browsing apart.
enum ProxyClient: String, Sendable {
    case download
    case player
    case browse
}

/// High-level orchestration: TMDB title → provider title → episode/movie embed
/// → playable HLS source. Caches resolved titles in memory for the session;
/// durable persistence lives in SwiftData `ProviderMapping` and is wired by
/// `DetailViewModel` (it reads a confirmed mapping and `prime`s this cache on
/// open, and saves the outcome after each resolve / manual confirm).
///
/// Two modes, both fully on-device (no remote server):
///  • **Diretto** — `ProviderClient`/`VixcloudClient` fetch straight from the
///    device IP, and playback URLs point at vixcloud directly.
///  • **WARP** — the same clients fetch through `WarpTunnel`'s proxied session
///    (hiding the device IP from StreamingCommunity/vixcloud), and playback
///    URLs point at `LocalHLSServer`'s live-proxy routes, which fetch the
///    upstream through the WARP tunnel and rewrite the playlist. AirPlay keeps
///    working because the phone is the proxy.
actor ProviderResolver {
    static let shared = ProviderResolver()

    private let provider: ProviderClient
    private let vix: VixcloudClient
    private var titleCache: [String: ProviderResolveTitleOutcome] = [:]
    /// Per-session auth token embedded in the on-device proxy URLs. Minted on
    /// each proxied resolve and pushed to `LocalHLSServer`.
    private var liveProxyToken = ""

    init(provider: ProviderClient = .shared,
         vix: VixcloudClient = .shared) {
        self.provider = provider
        self.vix = vix
    }

    struct PlaybackResolution: Sendable {
        /// Ordered playable sources (master first, then alternate servers).
        var sources: [VixcloudClient.PlaybackSource]
        var reason: ProviderResolveFailureReason?
        var message: String?
        var providerTitle: ProviderResolvedTitle?
        var candidates: [ProviderCandidate]
        /// Whether sources are served through the WARP proxy (`true`) or fetched
        /// directly from the provider/CDN (`false`). Drives the WARP/Diretto badge.
        var viaProxy: Bool = false
    }

    private func cacheKey(_ id: Int, _ type: MediaType, useProxy: Bool) -> String {
        "\(type.rawValue):\(id):\(useProxy ? "proxy" : "local")"
    }

    private func cacheKeysForAllModes(_ id: Int, _ type: MediaType) -> [String] {
        [
            cacheKey(id, type, useProxy: false),
            cacheKey(id, type, useProxy: true)
        ]
    }

    /// Seed the in-memory cache from a persisted mapping so a confirmed title
    /// is reused (and the embed resolve uses it) without re-searching.
    func prime(tmdbId: Int, mediaType: MediaType, outcome: ProviderResolveTitleOutcome) {
        for key in cacheKeysForAllModes(tmdbId, mediaType) {
            titleCache[key] = outcome
        }
    }

    /// Drop the cached title outcome (forces the next resolve to re-search).
    func invalidate(tmdbId: Int, mediaType: MediaType) {
        for key in cacheKeysForAllModes(tmdbId, mediaType) {
            titleCache[key] = nil
        }
    }

    // MARK: - WARP session wiring

    /// Effective egress mode resolved by `prepareWARP`.
    private enum WARPPrep {
        case direct        // WARP off — intentional direct egress from the device IP.
        case proxied       // Tunnel up — route through WARP.
        case unavailable   // WARP on but the tunnel won't start — fail closed.
    }

    /// Point the provider/vixcloud clients at the WARP-proxied session when
    /// proxy mode is on and the tunnel comes up.
    ///
    /// When WARP is enabled but the tunnel can't start we **fail closed**
    /// (`.unavailable`) rather than dropping to the device IP: a silent direct
    /// fallback would leak the exact IP WARP exists to hide. Callers surface an
    /// error instead of resolving direct.
    private func prepareWARP() async -> WARPPrep {
        guard AppSettings.shared.providerProxyActive else {
            await provider.setSession(.shared)
            await vix.setSession(.shared)
            await AnimeUnityClient.shared.setSession(.shared)
            return .direct
        }
        guard (try? await WarpTunnel.shared.start()) == true else {
            return .unavailable
        }
        let session = await WarpTunnel.shared.warpSession()
        await provider.setSession(session)
        await vix.setSession(session)
        await AnimeUnityClient.shared.setSession(session)
        return .proxied
    }

    /// Failure shown when WARP is on but the tunnel is down (fail-closed).
    private static let warpUnavailableMessage =
        "WARP attivo ma non raggiungibile. Riprova tra qualche secondo o disattiva WARP nelle impostazioni."

    private func warpUnavailableResolution() -> PlaybackResolution {
        PlaybackResolution(sources: [], reason: .temporarilyUnavailable,
                           message: Self.warpUnavailableMessage,
                           providerTitle: nil, candidates: [], viaProxy: true)
    }

    /// Resolve (or reuse cached) the provider title for a TMDB id.
    func resolveTitle(tmdbId: Int, mediaType: MediaType, title: String, releaseDate: String?, forceRefresh: Bool = false, client: ProxyClient = .browse) async -> ProviderResolveTitleOutcome {
        switch await prepareWARP() {
        case .unavailable:
            // Fail closed: a provider search would egress from the device IP.
            return ProviderResolveTitleOutcome(resolved: nil, reason: .temporarilyUnavailable, candidates: [], matchStatus: .failed)
        case .direct:
            return await resolveTitle(tmdbId: tmdbId, mediaType: mediaType, title: title, releaseDate: releaseDate, forceRefresh: forceRefresh, useProxy: false)
        case .proxied:
            return await resolveTitle(tmdbId: tmdbId, mediaType: mediaType, title: title, releaseDate: releaseDate, forceRefresh: forceRefresh, useProxy: true)
        }
    }

    /// Internal resolve once the session/mode is already prepared.
    private func resolveTitle(tmdbId: Int, mediaType: MediaType, title: String, releaseDate: String?, forceRefresh: Bool, useProxy: Bool) async -> ProviderResolveTitleOutcome {
        let key = cacheKey(tmdbId, mediaType, useProxy: useProxy)
        if !forceRefresh, let cached = titleCache[key] { return cached }
        let outcome = await provider.resolveTitle(tmdbId: tmdbId, mediaType: mediaType, title: title, releaseDate: releaseDate)
        titleCache[key] = outcome
        return outcome
    }

    /// Manually pin a candidate as the resolved title (provider picker).
    func confirmCandidate(_ candidate: ProviderCandidate, tmdbId: Int, mediaType: MediaType) {
        let resolved = ProviderResolvedTitle(id: candidate.providerTitleId, slug: candidate.providerSlug, title: candidate.title, mediaType: mediaType)
        let existingCandidates = cacheKeysForAllModes(tmdbId, mediaType)
            .compactMap { titleCache[$0]?.candidates }
            .first(where: { !$0.isEmpty }) ?? []
        let outcome = ProviderResolveTitleOutcome(
            resolved: resolved, reason: nil,
            candidates: existingCandidates, matchStatus: .manualConfirmed
        )
        for key in cacheKeysForAllModes(tmdbId, mediaType) {
            titleCache[key] = outcome
        }
    }

    // MARK: - Playable source

    func movieSource(tmdbId: Int, title: String, releaseDate: String?, client: ProxyClient) async -> PlaybackResolution {
        let useProxy: Bool
        switch await prepareWARP() {
        case .unavailable: return warpUnavailableResolution()
        case .direct: useProxy = false
        case .proxied: useProxy = true
        }
        let outcome = await resolveTitle(tmdbId: tmdbId, mediaType: .movie, title: title, releaseDate: releaseDate, forceRefresh: false, useProxy: useProxy)
        guard let resolved = outcome.resolved else {
            return PlaybackResolution(sources: [], reason: outcome.reason ?? .notFound, message: unavailableMessage(outcome.reason), providerTitle: nil, candidates: outcome.candidates, viaProxy: useProxy)
        }
        let embed = await provider.movieEmbed(providerTitleId: resolved.id)
        return await finalize(embed: embed, resolved: resolved, candidates: outcome.candidates, useProxy: useProxy, client: client)
    }

    func episodeSource(tmdbId: Int, title: String, releaseDate: String?, season: Int, episode: Int, client: ProxyClient) async -> PlaybackResolution {
        let useProxy: Bool
        switch await prepareWARP() {
        case .unavailable: return warpUnavailableResolution()
        case .direct: useProxy = false
        case .proxied: useProxy = true
        }
        let outcome = await resolveTitle(tmdbId: tmdbId, mediaType: .tv, title: title, releaseDate: releaseDate, forceRefresh: false, useProxy: useProxy)
        guard let resolved = outcome.resolved else {
            return PlaybackResolution(sources: [], reason: outcome.reason ?? .notFound, message: unavailableMessage(outcome.reason), providerTitle: nil, candidates: outcome.candidates, viaProxy: useProxy)
        }
        let embed = await provider.episodeEmbed(providerTitleId: resolved.id, slug: resolved.slug, season: season, episode: episode)
        return await finalize(embed: embed, resolved: resolved, candidates: outcome.candidates, useProxy: useProxy, client: client)
    }

    // MARK: - AnimeUnity (native catalog, no TMDB)

    /// Point the AnimeUnity client at the right egress before a catalog
    /// browse/search. Returns `false` when WARP is on but the tunnel won't start
    /// (fail closed — a direct request would leak the device IP), so the caller
    /// surfaces an error instead of scraping from the device IP.
    func ensureAnimeSession() async -> Bool {
        switch await prepareWARP() {
        case .unavailable: return false
        case .direct, .proxied: return true
        }
    }

    /// Resolve an AnimeUnity episode to playable sources. AnimeUnity has its own
    /// catalog/ids, so there's no TMDB title resolution — the caller already has
    /// the entry id, slug and episode id. The video path (embed → vixcloud →
    /// WARP/LocalHLSServer) is identical to StreamingCommunity.
    func animeSource(animeId: Int, slug: String?, episodeId: Int, client: ProxyClient) async -> PlaybackResolution {
        let useProxy: Bool
        switch await prepareWARP() {
        case .unavailable: return warpUnavailableResolution()
        case .direct: useProxy = false
        case .proxied: useProxy = true
        }
        let embedUrl: String
        do {
            embedUrl = try await AnimeUnityClient.shared.embedURL(episodeId: episodeId, animeId: animeId, slug: slug)
        } catch {
            let msg = (error as? LocalizedError)?.errorDescription ?? "Episodio non disponibile."
            return PlaybackResolution(sources: [], reason: .temporarilyUnavailable, message: msg, providerTitle: nil, candidates: [], viaProxy: useProxy)
        }
        return await buildSources(embedUrl: embedUrl, useProxy: useProxy, client: client, providerTitle: nil, candidates: [])
    }

    // MARK: - Finalize (embed → playable sources)

    /// Fetch the embed and build playable sources. In WARP mode the sources are
    /// `LocalHLSServer` proxy URLs (the phone fetches the upstream through the
    /// tunnel and rewrites the playlist); otherwise they're direct vixcloud URLs.
    private func finalize(embed: ProviderEmbedOutcome, resolved: ProviderResolvedTitle, candidates: [ProviderCandidate], useProxy: Bool, client: ProxyClient) async -> PlaybackResolution {
        guard let embedUrl = embed.embedUrl else {
            return PlaybackResolution(sources: [], reason: embed.reason ?? .notFound, message: unavailableMessage(embed.reason), providerTitle: resolved, candidates: candidates, viaProxy: useProxy)
        }
        return await buildSources(embedUrl: embedUrl, useProxy: useProxy, client: client, providerTitle: resolved, candidates: candidates)
    }

    /// Shared embed → playable sources core, used by both StreamingCommunity and
    /// AnimeUnity (both end at a vixcloud embed URL). `providerTitle`/`candidates`
    /// are SC-only metadata (nil/[] for anime).
    private func buildSources(embedUrl: String, useProxy: Bool, client: ProxyClient, providerTitle: ProviderResolvedTitle?, candidates: [ProviderCandidate]) async -> PlaybackResolution {
        let resolved = providerTitle
        let upstreamSources: [VixcloudClient.PlaybackSource]
        do {
            upstreamSources = try await vix.playbackSources(embedURL: embedUrl)
        } catch {
            return PlaybackResolution(sources: [], reason: .temporarilyUnavailable, message: (error as? LocalizedError)?.errorDescription ?? "Riproduzione non disponibile.", providerTitle: resolved, candidates: candidates, viaProxy: useProxy)
        }

        // Route through the on-device live proxy when WARP is on (hide IP) OR a
        // streaming quality is forced (the proxy filters the master to a single
        // variant — a true force, not just a cap). Diretto + Auto plays the
        // vixcloud URL directly (no extra hop).
        let forcedQuality = client == .player && AppSettings.shared.streamingMaxHeight > 0
        guard useProxy || forcedQuality else {
            return PlaybackResolution(sources: upstreamSources, reason: nil, message: nil, providerTitle: resolved, candidates: candidates, viaProxy: false)
        }

        // Serve via the on-device proxy. Its upstream egress is the WARP session
        // when WARP is active (IP hidden), else the direct `.shared` session —
        // so `viaProxy` (the badge) tracks WARP only, not the local hop.
        let port: UInt16
        do {
            port = try await LocalHLSServer.shared.ensureRunning()
        } catch {
            // Local proxy unavailable. In WARP mode we must NOT fall back to
            // direct vixcloud — AVPlayer would fetch the stream from the device
            // IP, leaking it. Fail closed. With only forced-quality requested
            // (no WARP) the direct fallback is safe (it just loses the cap).
            if useProxy { return warpUnavailableResolution() }
            return PlaybackResolution(sources: upstreamSources, reason: nil, message: nil, providerTitle: resolved, candidates: candidates, viaProxy: false)
        }

        let token = Self.mintLiveToken()
        liveProxyToken = token
        LocalHLSServer.shared.setLiveProxyToken(token)

        // Canonical loopback URLs (on-device playback needs no Local Network
        // permission). `PlaybackController` swaps the host to the LAN IP for
        // AirPlay and appends `c=`/`q=` itself, so we pass neutral values here.
        let proxied = upstreamSources.compactMap { src in
            LocalHLSServer.liveProxyURL(forUpstream: src.playlistURL, host: nil, port: port, key: token, client: "-", maxHeight: 0)
        }.map { VixcloudClient.PlaybackSource(playlistURL: $0, headers: [:]) }

        guard !proxied.isEmpty else {
            return PlaybackResolution(sources: [], reason: .temporarilyUnavailable, message: "Stream non trovato nella pagina del player.", providerTitle: resolved, candidates: candidates, viaProxy: useProxy)
        }
        return PlaybackResolution(sources: proxied, reason: nil, message: nil, providerTitle: resolved, candidates: candidates, viaProxy: useProxy)
    }

    /// 128-bit URL-safe auth token for the on-device proxy session.
    private static func mintLiveToken() -> String {
        UUID().uuidString.replacingOccurrences(of: "-", with: "")
    }

    private func unavailableMessage(_ reason: ProviderResolveFailureReason?) -> String {
        switch reason {
        case .temporarilyUnavailable: return "Riproduzione temporaneamente non disponibile"
        case .unreleased: return "Non ancora disponibile"
        default: return "Titolo non disponibile"
        }
    }
}
