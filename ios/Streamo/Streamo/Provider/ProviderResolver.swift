import Foundation

/// High-level orchestration: TMDB title → provider title → episode/movie embed
/// → playable HLS source. Caches resolved titles in memory for the session;
/// durable persistence lives in SwiftData `ProviderMapping` and is wired by
/// `DetailViewModel` (it reads a confirmed mapping and `prime`s this cache on
/// open, and saves the outcome after each resolve / manual confirm). Mirrors
/// the flow in the web PlayerService.
actor ProviderResolver {
    static let shared = ProviderResolver()

    private let provider: ProviderClient
    private let vix: VixcloudClient
    private var titleCache: [String: ProviderResolveTitleOutcome] = [:]

    init(provider: ProviderClient = .shared, vix: VixcloudClient = .shared) {
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
    }

    private func cacheKey(_ id: Int, _ type: MediaType) -> String { "\(type.rawValue):\(id)" }

    /// Seed the in-memory cache from a persisted mapping so a confirmed title
    /// is reused (and the embed resolve uses it) without re-searching.
    func prime(tmdbId: Int, mediaType: MediaType, outcome: ProviderResolveTitleOutcome) {
        titleCache[cacheKey(tmdbId, mediaType)] = outcome
    }

    /// Drop the cached title outcome (forces the next resolve to re-search).
    func invalidate(tmdbId: Int, mediaType: MediaType) {
        titleCache[cacheKey(tmdbId, mediaType)] = nil
    }

    /// Resolve (or reuse cached) the provider title for a TMDB id.
    func resolveTitle(tmdbId: Int, mediaType: MediaType, title: String, releaseDate: String?, forceRefresh: Bool = false) async -> ProviderResolveTitleOutcome {
        let key = cacheKey(tmdbId, mediaType)
        if !forceRefresh, let cached = titleCache[key] { return cached }
        let outcome = await provider.resolveTitle(tmdbId: tmdbId, mediaType: mediaType, title: title, releaseDate: releaseDate)
        titleCache[key] = outcome
        return outcome
    }

    /// Manually pin a candidate as the resolved title (provider picker).
    func confirmCandidate(_ candidate: ProviderCandidate, tmdbId: Int, mediaType: MediaType) {
        let resolved = ProviderResolvedTitle(id: candidate.providerTitleId, slug: candidate.providerSlug, title: candidate.title, mediaType: mediaType)
        let existing = titleCache[cacheKey(tmdbId, mediaType)]
        titleCache[cacheKey(tmdbId, mediaType)] = ProviderResolveTitleOutcome(
            resolved: resolved, reason: nil,
            candidates: existing?.candidates ?? [], matchStatus: .manualConfirmed
        )
    }

    // MARK: - Playable source

    func movieSource(tmdbId: Int, title: String, releaseDate: String?) async -> PlaybackResolution {
        let outcome = await resolveTitle(tmdbId: tmdbId, mediaType: .movie, title: title, releaseDate: releaseDate)
        guard let resolved = outcome.resolved else {
            return PlaybackResolution(sources: [], reason: outcome.reason ?? .notFound, message: unavailableMessage(outcome.reason), providerTitle: nil, candidates: outcome.candidates)
        }
        let embed = await provider.movieEmbed(providerTitleId: resolved.id)
        return await finalize(embed: embed, resolved: resolved, candidates: outcome.candidates)
    }

    func episodeSource(tmdbId: Int, title: String, releaseDate: String?, season: Int, episode: Int) async -> PlaybackResolution {
        let outcome = await resolveTitle(tmdbId: tmdbId, mediaType: .tv, title: title, releaseDate: releaseDate)
        guard let resolved = outcome.resolved else {
            return PlaybackResolution(sources: [], reason: outcome.reason ?? .notFound, message: unavailableMessage(outcome.reason), providerTitle: nil, candidates: outcome.candidates)
        }
        let embed = await provider.episodeEmbed(providerTitleId: resolved.id, slug: resolved.slug, season: season, episode: episode)
        return await finalize(embed: embed, resolved: resolved, candidates: outcome.candidates)
    }

    private func finalize(embed: ProviderEmbedOutcome, resolved: ProviderResolvedTitle, candidates: [ProviderCandidate]) async -> PlaybackResolution {
        guard let embedUrl = embed.embedUrl else {
            return PlaybackResolution(sources: [], reason: embed.reason ?? .notFound, message: unavailableMessage(embed.reason), providerTitle: resolved, candidates: candidates)
        }
        do {
            let sources = try await vix.playbackSources(embedURL: embedUrl)
            return PlaybackResolution(sources: sources, reason: nil, message: nil, providerTitle: resolved, candidates: candidates)
        } catch {
            return PlaybackResolution(sources: [], reason: .temporarilyUnavailable, message: (error as? LocalizedError)?.errorDescription ?? "Riproduzione non disponibile.", providerTitle: resolved, candidates: candidates)
        }
    }

    private func unavailableMessage(_ reason: ProviderResolveFailureReason?) -> String {
        switch reason {
        case .temporarilyUnavailable: return "Riproduzione temporaneamente non disponibile"
        case .unreleased: return "Non ancora disponibile"
        default: return "Titolo non disponibile"
        }
    }
}
