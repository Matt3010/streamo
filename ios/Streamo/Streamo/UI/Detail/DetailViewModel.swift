import Foundation
import Observation

@MainActor
@Observable
final class DetailViewModel {
    let ref: MediaRef

    private(set) var item: TmdbItem?
    private(set) var recommendations: [TmdbItem] = []
    private(set) var reviews: [TmdbReview] = []
    private(set) var isLoading = true
    /// Reviews + recommendations load after the main detail; drives skeletons.
    private(set) var extrasLoading = false
    private(set) var loadError: String?

    // TV season/episode state
    private(set) var seasons: [Int] = []
    var selectedSeason = 1
    private(set) var episodes: [TmdbEpisodeDetail] = []
    private(set) var loadingEpisodes = false

    // Provider resolution state (drives the play button + version picker)
    enum ProviderAvailability { case resolving, ready, needsPicker, unavailable }
    private(set) var providerAvailability: ProviderAvailability = .resolving
    private(set) var providerCandidates: [ProviderCandidate] = []
    private(set) var providerMatchStatus: ProviderMatchStatus?
    private(set) var providerResolvedId: Int?
    private(set) var providerMessage: String?

    private let client: TMDBClient

    init(ref: MediaRef, client: TMDBClient = .shared) {
        self.ref = ref
        self.client = client
    }

    var isTV: Bool { ref.mediaType == .tv }

    /// `explicitSeason` is the season from a deep link (e.g. continue-watching);
    /// when absent, `resolveSeason` derives it from the user's progress so the
    /// dropdown lands on where they left off, not season 1.
    func load(initialSeason explicitSeason: Int?, resolveSeason: (TmdbItem) -> Int? = { _ in nil }) async {
        isLoading = true
        loadError = nil
        do {
            let loaded = try await client.details(id: ref.tmdbId, type: ref.mediaType)
            item = loaded
            if ref.mediaType == .tv {
                seasons = TVLogic.availableSeasons(loaded)
                let preferred = explicitSeason ?? resolveSeason(loaded)
                let target = preferred.flatMap { seasons.contains($0) ? $0 : nil } ?? seasons.first ?? 1
                selectedSeason = target
                await loadSeason(target)
            }
        } catch {
            loadError = (error as? LocalizedError)?.errorDescription ?? "Errore di caricamento."
        }
        isLoading = false

        extrasLoading = true
        async let recs = try? await client.recommendations(id: ref.tmdbId, type: ref.mediaType)
        async let revs = try? await client.reviews(id: ref.tmdbId, type: ref.mediaType)
        recommendations = Array((await recs ?? []).prefix(20))
        reviews = Array((await revs ?? []).prefix(10))
        extrasLoading = false
    }

    /// True when the title (or whole series) hasn't released yet.
    var isUpcoming: Bool {
        guard let item else { return false }
        return Release.isUpcoming(item, ref.mediaType)
    }

    /// Full release/status sentence shown under the metadata (port of
    /// getFullReleaseStatusText). Empty when there's nothing to say.
    var releaseStatusText: String {
        guard let item else { return "" }
        return Release.fullStatus(item, ref.mediaType)
    }

    // MARK: - Provider resolution

    func resolveProvider(library: Library) async {
        guard let item else { return }
        if isUpcoming {
            providerAvailability = .unavailable
            providerMessage = "Non ancora disponibile"
            return
        }
        // Seed the resolver from a persisted confirmed mapping so we skip a
        // redundant search and honour a previous manual pick.
        if let m = library.providerMapping(item.id, ref.mediaType) {
            let status = ProviderMatchStatus(rawValue: m.matchStatusRaw) ?? .failed
            if (status == .autoConfirmed || status == .manualConfirmed), let pid = m.providerId {
                let resolved = ProviderResolvedTitle(id: pid, slug: m.providerSlug,
                                                     title: m.resolvedTitle ?? item.displayTitle, mediaType: ref.mediaType)
                await ProviderResolver.shared.prime(tmdbId: item.id, mediaType: ref.mediaType,
                    outcome: ProviderResolveTitleOutcome(resolved: resolved, reason: nil,
                        candidates: library.decodeCandidates(m.candidatesJSON), matchStatus: status))
            }
        }
        providerAvailability = .resolving
        let outcome = await ProviderResolver.shared.resolveTitle(
            tmdbId: item.id, mediaType: ref.mediaType, title: item.displayTitle, releaseDate: item.primaryDate)
        applyProviderOutcome(outcome, item: item, library: library)
    }

    func refreshProvider(library: Library) async {
        guard let item else { return }
        await ProviderResolver.shared.invalidate(tmdbId: item.id, mediaType: ref.mediaType)
        // Force a fresh catalog base URL too, so a manual retry recovers after
        // the streamingcommunity domain rotates (web relies on its short TTL).
        await ProviderClient.shared.invalidateBaseURL()
        providerAvailability = .resolving
        let outcome = await ProviderResolver.shared.resolveTitle(
            tmdbId: item.id, mediaType: ref.mediaType, title: item.displayTitle, releaseDate: item.primaryDate, forceRefresh: true)
        applyProviderOutcome(outcome, item: item, library: library)
    }

    func confirmProvider(_ candidate: ProviderCandidate, library: Library) async {
        guard let item else { return }
        await ProviderResolver.shared.confirmCandidate(candidate, tmdbId: item.id, mediaType: ref.mediaType)
        let resolved = ProviderResolvedTitle(id: candidate.providerTitleId, slug: candidate.providerSlug,
                                             title: candidate.title, mediaType: ref.mediaType)
        providerResolvedId = candidate.providerTitleId
        providerMatchStatus = .manualConfirmed
        providerMessage = nil
        providerAvailability = .ready
        library.saveProviderMapping(tmdbId: item.id, type: ref.mediaType, resolved: resolved,
                                    candidates: providerCandidates, matchStatus: .manualConfirmed,
                                    sourceTitle: item.displayTitle, releaseYear: item.year)
    }

    private func applyProviderOutcome(_ outcome: ProviderResolveTitleOutcome, item: TmdbItem, library: Library) {
        providerCandidates = outcome.candidates
        providerMatchStatus = outcome.matchStatus
        providerResolvedId = outcome.resolved?.id
        let status = outcome.matchStatus ?? .failed
        library.saveProviderMapping(tmdbId: item.id, type: ref.mediaType, resolved: outcome.resolved,
                                    candidates: outcome.candidates, matchStatus: status,
                                    sourceTitle: item.displayTitle, releaseYear: item.year)
        if outcome.resolved != nil {
            providerAvailability = .ready
            providerMessage = nil
        } else if !outcome.candidates.isEmpty {
            providerAvailability = .needsPicker
            providerMessage = "Scegli la versione giusta dalla lista."
        } else {
            providerAvailability = .unavailable
            providerMessage = outcome.reason == .temporarilyUnavailable
                ? "Riproduzione temporaneamente non disponibile" : "Titolo non disponibile"
        }
    }

    func changeSeason(_ season: Int) async {
        guard seasons.contains(season) else { return }
        selectedSeason = season
        await loadSeason(season)
    }

    private func loadSeason(_ season: Int) async {
        guard let item else { return }
        loadingEpisodes = true
        let details = try? await client.seasonDetails(tvId: item.id, season: season)
        let aired = TVLogic.airedEpisodeList(details?.episodes ?? [], item: item, season: season)
        if aired.isEmpty {
            let count = (item.seasons ?? []).first { $0.seasonNumber == season }?.episodeCount ?? 10
            episodes = (1...max(1, count)).map { TmdbEpisodeDetail.stub($0) }
        } else {
            episodes = aired
        }
        loadingEpisodes = false
    }

    // MARK: Derived display strings

    var metaLine: String {
        guard let item else { return "" }
        var parts: [String] = []
        if let y = item.year { parts.append(String(y)) }
        if let rt = runtimeText { parts.append(rt) }
        if let v = item.voteAverage, v > 0 { parts.append(String(format: "★ %.1f", v)) }
        return parts.joined(separator: " · ")
    }

    /// Best YouTube trailer URL from the TMDB videos payload, if any.
    var trailerURL: URL? {
        let videos = (item?.videos?.results ?? []).filter { $0.site == "YouTube" && $0.key != nil }
        guard !videos.isEmpty else { return nil }
        let best = videos.first { $0.type == "Trailer" && $0.official == true }
            ?? videos.first { $0.type == "Trailer" }
            ?? videos.first
        guard let key = best?.key else { return nil }
        return URL(string: "https://www.youtube.com/watch?v=\(key)")
    }

    var genresLine: String { (item?.genres ?? []).map(\.name).joined(separator: ", ") }
    var castLine: String { (item?.credits?.cast ?? []).prefix(6).map(\.name).joined(separator: ", ") }

    /// Popularity badge value ("🔥 …"), nil when popularity is 0 — port of getMediaRankBadge.
    var rankBadge: String? {
        guard let p = item?.popularity, p > 0 else { return nil }
        return Int(p.rounded()).formatted(.number.grouping(.automatic))
    }

    /// "3 stagioni · 24/30 episodi usciti" — port of watch.component tvSummaryStr.
    var tvSummary: String {
        guard ref.mediaType == .tv, let it = item else { return "" }
        let seasons = it.numberOfSeasons ?? 0
        let episodes = it.numberOfEpisodes ?? 0
        guard seasons > 0 else { return "" }
        let ses = seasons == 1 ? "stagione" : "stagioni"
        let eps = episodes == 1 ? "episodio" : "episodi"
        guard episodes > 0 else { return "\(seasons) \(ses)" }
        let aired = TVLogic.airedEpisodesCount(it)
        if aired > 0 && aired < episodes { return "\(seasons) \(ses) · \(aired)/\(episodes) \(eps) usciti" }
        return "\(seasons) \(ses) · \(episodes) \(eps)"
    }

    /// Port of the web `formatRuntime`: movies as "Hh Mmin" / "Hh" / "Mmin",
    /// TV as "N min/episodio".
    private var runtimeText: String? {
        guard let item else { return nil }
        if ref.mediaType == .tv {
            guard let m = item.episodeRunTime?.first, m > 0 else { return nil }
            return "\(m) min/episodio"
        }
        guard let m = item.runtime, m > 0 else { return nil }
        let h = m / 60, mm = m % 60
        if h > 0 && mm > 0 { return "\(h)h \(mm)min" }
        if h > 0 { return "\(h)h" }
        return "\(mm)min"
    }
}
