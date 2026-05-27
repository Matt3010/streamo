import Foundation

/// Scrapes streamingcommunity to map a TMDB title to a playable vixcloud embed
/// URL. Port of server/src/services/provider-resolver.ts (the network + parse
/// + scoring parts). Pure Foundation so it can be unit-tested off-device.
actor ProviderClient {
    static let shared = ProviderClient()

    // Same constants as the web config.
    private let linkSourceURL = URL(string: "https://api.telegra.ph/getPage/Link-Aggiornato-StreamingCommunity-09-29?return_content=true")!
    private let requestTimeout: TimeInterval = 8
    static let strongMatchThreshold = 170
    static let minCandidateScore = 40
    static let maxStoredCandidates = 10

    private let session: URLSession
    private let decoder: JSONDecoder

    private var cachedBaseURL: String?
    private var baseURLFetchedAt: Date?
    // Short TTL like the web (PROVIDER_LINK_SOURCE_CACHE_TTL): the
    // streamingcommunity domain rotates often, so a stale base URL must expire
    // quickly or every request keeps hitting a dead host.
    private let baseURLTTL: TimeInterval = 10 * 60

    init(session: URLSession = .shared) {
        self.session = session
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        self.decoder = d
    }

    private var locale: String { AppSettings.shared.providerLocale }

    // MARK: - Title resolution

    /// Search + score, returning the best auto-match (>= strong threshold) plus
    /// the candidate list for the picker.
    func resolveTitle(tmdbId: Int, mediaType: MediaType, title: String, releaseDate: String?) async -> ProviderResolveTitleOutcome {
        let query = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else {
            return ProviderResolveTitleOutcome(resolved: nil, reason: .notFound, candidates: [], matchStatus: .failed)
        }
        // Don't bother the provider with titles that haven't been released yet
        // (port of the web's isFutureDateStr early-out).
        if TVLogic.isFutureDate(releaseDate) {
            return ProviderResolveTitleOutcome(resolved: nil, reason: .unreleased, candidates: [], matchStatus: .failed)
        }
        guard let titles = await search(query: query) else {
            return ProviderResolveTitleOutcome(resolved: nil, reason: .temporarilyUnavailable, candidates: [], matchStatus: nil)
        }

        let wantedYear = Self.extractYear(releaseDate)
        let ranked = titles
            .filter { $0.id != nil && Self.normalizeType($0.type) == mediaType }
            .map { ($0, Self.score(candidate: $0, wantedTitle: query, wantedYear: wantedYear)) }
            .sorted { $0.1 > $1.1 }

        let candidates = ranked
            .filter { $0.1 >= Self.minCandidateScore }
            .prefix(Self.maxStoredCandidates)
            .map { (t, s) in
                ProviderCandidate(
                    providerTitleId: t.id!, providerSlug: t.slug,
                    title: t.name?.trimmed ?? query, year: Self.extractYear(Self.releaseDate(of: t)),
                    score: s, posterUrl: nil
                )
            }

        guard let best = ranked.first, best.1 >= Self.minCandidateScore, let bestId = best.0.id else {
            return ProviderResolveTitleOutcome(resolved: nil, reason: .notFound, candidates: Array(candidates), matchStatus: .failed)
        }

        if best.1 >= Self.strongMatchThreshold {
            let resolved = ProviderResolvedTitle(id: bestId, slug: best.0.slug, title: best.0.name?.trimmed ?? query, mediaType: mediaType)
            return ProviderResolveTitleOutcome(resolved: resolved, reason: nil, candidates: Array(candidates), matchStatus: .autoConfirmed)
        }

        // Weak match: don't auto-use it, but keep candidates for the picker.
        return ProviderResolveTitleOutcome(resolved: nil, reason: .notFound, candidates: Array(candidates), matchStatus: .failed)
    }

    // MARK: - Episode / movie embed

    /// Resolve a TV episode to its absolute vixcloud embed URL.
    func episodeEmbed(providerTitleId: Int, slug: String?, season: Int, episode: Int) async -> ProviderEmbedOutcome {
        guard let loaded = await fetchSeason(providerTitleId: providerTitleId, slug: slug, seasonNumber: season),
              let episodes = loaded.episodes, !episodes.isEmpty else {
            return ProviderEmbedOutcome(embedUrl: nil, reason: .temporarilyUnavailable)
        }
        guard let match = episodes.first(where: { $0.number == episode && $0.id != nil }), let episodeId = match.id else {
            return ProviderEmbedOutcome(embedUrl: nil, reason: .notFound)
        }
        guard let embed = await fetchEmbedURL(providerTitleId: providerTitleId, episodeId: episodeId) else {
            return ProviderEmbedOutcome(embedUrl: nil, reason: .temporarilyUnavailable)
        }
        return ProviderEmbedOutcome(embedUrl: embed, reason: nil)
    }

    /// Resolve a movie to its absolute vixcloud embed URL.
    func movieEmbed(providerTitleId: Int) async -> ProviderEmbedOutcome {
        guard let embed = await fetchEmbedURL(providerTitleId: providerTitleId, episodeId: nil) else {
            return ProviderEmbedOutcome(embedUrl: nil, reason: .temporarilyUnavailable)
        }
        return ProviderEmbedOutcome(embedUrl: embed, reason: nil)
    }

    // MARK: - Network primitives

    private func search(query: String) async -> [ProviderSearchTitle]? {
        guard let base = await baseURL() else { return nil }
        var comps = URLComponents(string: "\(base)/\(locale)/search")!
        comps.queryItems = [URLQueryItem(name: "q", value: query)]
        guard let url = comps.url, let (data, http) = await get(url) else { return nil }
        guard (200...299).contains(http.statusCode) else { return nil }

        let page: ProviderSearchPage?
        if (http.value(forHTTPHeaderField: "content-type") ?? "").contains("application/json") {
            page = try? decoder.decode(ProviderSearchPage.self, from: data)
        } else {
            page = parseInertiaPage(html: String(decoding: data, as: UTF8.self), as: ProviderSearchPage.self)
        }
        return page?.props?.titles?.titles
    }

    private func fetchSeason(providerTitleId: Int, slug: String?, seasonNumber: Int) async -> ProviderLoadedSeason? {
        guard let base = await baseURL() else { return nil }
        let resolvedSlug = (slug?.trimmed).flatMap { $0.isEmpty ? nil : $0 } ?? ""
        // The web falls back to a DB-stored slug; here the caller passes it.
        guard !resolvedSlug.isEmpty else { return nil }
        guard let url = URL(string: "\(base)/\(locale)/titles/\(providerTitleId)-\(resolvedSlug)/season-\(seasonNumber)"),
              let (data, http) = await get(url), (200...299).contains(http.statusCode) else { return nil }

        let page: ProviderTitlePage?
        if (http.value(forHTTPHeaderField: "content-type") ?? "").contains("application/json") {
            page = try? decoder.decode(ProviderTitlePage.self, from: data)
        } else {
            page = parseInertiaPage(html: String(decoding: data, as: UTF8.self), as: ProviderTitlePage.self)
        }
        return page?.props?.loadedSeason
    }

    /// Fetch the iframe page and extract the absolute vixcloud embed URL.
    private func fetchEmbedURL(providerTitleId: Int, episodeId: Int?) async -> String? {
        guard let base = await baseURL() else { return nil }
        var comps = URLComponents(string: "\(base)/\(locale)/iframe/\(providerTitleId)")!
        if let episodeId {
            comps.queryItems = [
                URLQueryItem(name: "episode_id", value: String(episodeId)),
                URLQueryItem(name: "next_episode", value: "1"),
            ]
        }
        guard let url = comps.url, let (data, http) = await get(url), (200...299).contains(http.statusCode) else { return nil }
        let html = String(decoding: data, as: UTF8.self)

        guard let raw = Self.firstMatch(in: html, pattern: "<iframe[^>]+src=\"([^\"]+)\"")
                ?? Self.firstMatch(in: html, pattern: "<iframe[^>]+src='([^']+)'") else { return nil }
        let embed = Self.decodeHTMLEntities(raw.trimmed)

        guard let parsed = URL(string: embed),
              parsed.host == "vixcloud.co",
              parsed.path.hasPrefix("/embed/") else { return nil }
        return embed
    }

    // MARK: - Base URL (telegra.ph)

    private func baseURL() async -> String? {
        if let cached = cachedBaseURL, let at = baseURLFetchedAt, Date().timeIntervalSince(at) < baseURLTTL {
            return cached
        }
        guard let (data, http) = await get(linkSourceURL, accept: "application/json"),
              (200...299).contains(http.statusCode),
              let resp = try? JSONDecoder().decode(TelegraphResponse.self, from: data),
              let href = Self.firstHref(in: resp.result?.content),
              let normalized = Self.normalizeBaseURL(href) else {
            return cachedBaseURL // fall back to a stale value if we have one
        }
        cachedBaseURL = normalized
        baseURLFetchedAt = Date()
        return normalized
    }

    /// Force a re-fetch of the catalog base URL (used after a transient failure).
    func invalidateBaseURL() { cachedBaseURL = nil; baseURLFetchedAt = nil }

    // MARK: - HTTP

    private func get(_ url: URL, accept: String = "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8") async -> (Data, HTTPURLResponse)? {
        var request = URLRequest(url: url)
        request.timeoutInterval = requestTimeout
        request.setValue(accept, forHTTPHeaderField: "Accept")
        request.setValue("", forHTTPHeaderField: "Referer") // no-referrer like the web
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { return nil }
            return (data, http)
        } catch {
            return nil
        }
    }

    // MARK: - Inertia page parsing

    /// Extract and decode the Inertia `data-page="..."` JSON blob from an HTML page.
    private func parseInertiaPage<T: Decodable>(html: String, as type: T.Type) -> T? {
        let marker = "data-page="
        guard let range = html.range(of: marker) else { return nil }
        let after = html[range.upperBound...]
        guard let quote = after.first, quote == "\"" || quote == "'" else { return nil }

        var value = ""
        var idx = after.index(after.startIndex, offsetBy: 1)
        while idx < after.endIndex {
            let ch = after[idx]
            if ch == quote { break }
            value.append(ch)
            idx = after.index(after: idx)
        }
        guard !value.isEmpty else { return nil }
        let json = Self.decodeHTMLEntities(value)
        guard let data = json.data(using: .utf8) else { return nil }
        return try? decoder.decode(T.self, from: data)
    }

    // MARK: - Scoring (port of scoreCandidate / tokenOverlapScore / normalizeTitle)

    static func score(candidate: ProviderSearchTitle, wantedTitle: String, wantedYear: Int?) -> Int {
        guard let candTitle = candidate.name?.trimmed, !candTitle.isEmpty else { return 0 }
        let wantedNorm = normalizeTitle(wantedTitle)
        let candNorm = normalizeTitle(candTitle)
        guard !wantedNorm.isEmpty, !candNorm.isEmpty else { return 0 }

        var score = tokenOverlapScore(wantedNorm, candNorm)
        if candNorm == wantedNorm { score += 120 }
        else if candNorm.hasPrefix(wantedNorm) || wantedNorm.hasPrefix(candNorm) { score += 70 }
        else if candNorm.contains(wantedNorm) || wantedNorm.contains(candNorm) { score += 35 }

        let candYear = extractYear(releaseDate(of: candidate))
        if let wy = wantedYear, let cy = candYear {
            if cy == wy { score += 35 }
            else if abs(cy - wy) == 1 { score += 10 }
            else { score -= 20 }
        }
        return score
    }

    static func tokenOverlapScore(_ a: String, _ b: String) -> Int {
        let aTokens = Set(a.split(separator: " ").map(String.init))
        let bTokens = Set(b.split(separator: " ").map(String.init))
        guard !aTokens.isEmpty, !bTokens.isEmpty else { return 0 }
        let overlap = aTokens.filter { bTokens.contains($0) }.count
        let total = max(aTokens.count, bTokens.count)
        return Int((Double(overlap) / Double(total) * 100).rounded())
    }

    static func normalizeTitle(_ value: String) -> String {
        let folded = value.folding(options: .diacriticInsensitive, locale: .init(identifier: "en_US_POSIX")).lowercased()
        let cleaned = folded.map { ($0.isLetter || $0.isNumber) ? $0 : " " }
        return String(cleaned).split(separator: " ").joined(separator: " ")
    }

    static func normalizeType(_ value: String?) -> MediaType? {
        switch value {
        case "movie": return .movie
        case "tv": return .tv
        default: return nil
        }
    }

    static func releaseDate(of title: ProviderSearchTitle) -> String? {
        if let t = title.translations?.first(where: { $0.key == "release_date" || $0.key == "last_air_date" })?.value {
            return t
        }
        return title.lastAirDate
    }

    static func extractYear(_ value: String?) -> Int? {
        guard let value else { return nil }
        guard let match = firstMatch(in: value, pattern: "\\b(\\d{4})\\b") else { return nil }
        return Int(match)
    }

    // MARK: - HTML helpers

    static func decodeHTMLEntities(_ value: String) -> String {
        var s = value
        let replacements: [(String, String)] = [
            ("&quot;", "\""), ("&#34;", "\""),
            ("&apos;", "'"), ("&#039;", "'"), ("&#39;", "'"),
            ("&lt;", "<"), ("&gt;", ">"),
            ("&amp;", "&"),
        ]
        for (from, to) in replacements { s = s.replacingOccurrences(of: from, with: to) }
        return s
    }

    static func firstHref(in nodes: [TelegraphNode]?) -> String? {
        guard let nodes else { return nil }
        for node in nodes {
            if let href = href(in: node) { return href }
        }
        return nil
    }

    private static func href(in node: TelegraphNode) -> String? {
        if let h = node.attrs?.href?.trimmed, !h.isEmpty { return h }
        for child in node.children ?? [] {
            if case .node(let n) = child, let h = href(in: n) { return h }
        }
        return nil
    }

    static func normalizeBaseURL(_ href: String) -> String? {
        guard let url = URL(string: href), url.scheme != nil, url.host != nil else { return nil }
        var s = url.absoluteString
        if s.hasSuffix("/") { s.removeLast() }
        return s
    }

    /// First capture group of `pattern` in `text`, or nil.
    static func firstMatch(in text: String, pattern: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
        let range = NSRange(text.startIndex..., in: text)
        guard let m = regex.firstMatch(in: text, range: range), m.numberOfRanges > 1,
              let r = Range(m.range(at: 1), in: text) else { return nil }
        return String(text[r])
    }
}

extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
