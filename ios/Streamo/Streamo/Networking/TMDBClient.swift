import Foundation

/// Talks to TMDB directly (the web app proxied this through nginx). Port of
/// `tmdb.service.ts`. Mirrors its language/region defaults (it-IT, region IT)
/// and the multi-URL reviews fallback.
actor TMDBClient {
    static let shared = TMDBClient()

    private let base = URL(string: "https://api.themoviedb.org/3")!
    private let session: URLSession
    private let decoder = JSONDecoder()

    enum TMDBError: Error, LocalizedError {
        case missingApiKey
        case badResponse(Int)
        var errorDescription: String? {
            switch self {
            case .missingApiKey: return "Chiave API TMDB mancante. Inseriscila nelle Impostazioni."
            case .badResponse(let code): return "TMDB ha risposto \(code)."
            }
        }
    }

    // TMDB is neutral metadata (not the streaming provider), so it always
    // egresses directly — never through WARP. WARP hides the device IP from
    // StreamingCommunity/vixcloud only; routing the catalog through it just
    // coupled browsing to tunnel health for no privacy gain.
    init(session: URLSession = .shared) {
        self.session = session
    }

    private var apiKey: String {
        AppSettings.shared.tmdbApiKey.trimmingCharacters(in: .whitespaces)
    }

    // MARK: - Public API

    /// Movie/TV detail with credits + videos appended.
    func details(id: Int, type: MediaType) async throws -> TmdbItem {
        try await get(
            path: "/\(type.rawValue)/\(id)",
            query: ["append_to_response": "credits,videos"]
        )
    }

    func seasonDetails(tvId: Int, season: Int) async throws -> TmdbSeasonDetails {
        try await get(path: "/tv/\(tvId)/season/\(season)")
    }

    func recommendations(id: Int, type: MediaType) async throws -> [TmdbItem] {
        let res: TmdbListResponse<TmdbItem> = try await get(path: "/\(type.rawValue)/\(id)/recommendations")
        return res.results ?? []
    }

    /// Reviews with the web app's it-IT → default → en-US fallback chain.
    func reviews(id: Int, type: MediaType) async throws -> [TmdbReview] {
        let attempts: [[String: String]] = [
            ["language": "it-IT"],
            [:],
            ["language": "en-US"],
        ]
        for q in attempts {
            let res: TmdbListResponse<TmdbReview> = try await get(
                path: "/\(type.rawValue)/\(id)/reviews", query: q, includeDefaultLanguage: false
            )
            if let r = res.results, !r.isEmpty { return r }
        }
        return []
    }

    /// A home-row list endpoint (e.g. "/trending/movie/day"), sorted newest-first.
    func list(_ endpoint: String) async throws -> [TmdbItem] {
        let res: TmdbListResponse<TmdbItem> = try await get(path: endpoint, query: ["region": "IT"])
        return Self.sortByNewest(res.results ?? [])
    }

    /// multi-search filtered to movie/tv, newest-first.
    func searchMulti(_ query: String) async throws -> [TmdbItem] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        let res: TmdbListResponse<TmdbItem> = try await get(path: "/search/multi", query: ["query": trimmed])
        let filtered = (res.results ?? []).filter { $0.mediaType == "movie" || $0.mediaType == "tv" }
        return Self.sortByNewest(filtered)
    }

    // MARK: - Core request

    private func get<T: Decodable>(
        path: String,
        query: [String: String] = [:],
        includeDefaultLanguage: Bool = true
    ) async throws -> T {
        guard !apiKey.isEmpty else { throw TMDBError.missingApiKey }

        var components = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        var items = [URLQueryItem(name: "api_key", value: apiKey)]
        if includeDefaultLanguage, query["language"] == nil {
            items.append(URLQueryItem(name: "language", value: "it-IT"))
        }
        for (k, v) in query { items.append(URLQueryItem(name: k, value: v)) }
        components.queryItems = items

        var request = URLRequest(url: components.url!)
        request.timeoutInterval = 15

        let (data, response) = try await session.data(for: request)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw TMDBError.badResponse(http.statusCode)
        }
        return try decoder.decode(T.self, from: data)
    }

    // MARK: - Helpers

    static func sortByNewest(_ items: [TmdbItem]) -> [TmdbItem] {
        items.sorted { newestTimestamp($0) > newestTimestamp($1) }
    }

    private static func newestTimestamp(_ item: TmdbItem) -> TimeInterval {
        guard let raw = item.primaryDate, !raw.isEmpty else { return 0 }
        return Self.dateFormatter.date(from: raw)?.timeIntervalSince1970 ?? 0
    }

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .iso8601)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
}
