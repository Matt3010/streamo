import Foundation

/// Scrapes AnimeUnity's JSON endpoints into the app's anime catalog. Native
/// (own ids, no TMDB). The video path stops at a vixcloud embed URL, which
/// `VixcloudClient` then resolves exactly like StreamingCommunity — so this
/// client only owns search/browse/episodes/embed-url.
///
/// AnimeUnity is Laravel + Livewire: the JSON endpoints need a CSRF token
/// (`<meta name="csrf-token">` from the homepage) plus the `animeunity_session`
/// cookie. The token is cached and re-bootstrapped on a 419 (token expired).
actor AnimeUnityClient {
    static let shared = AnimeUnityClient()

    /// Catalog host. AnimeUnity rotates domains; this is the current primary and
    /// can be overridden from Advanced settings if it moves.
    private var baseURL: String { AppSettings.shared.animeUnityBaseURL }
    private let requestTimeout: TimeInterval = 12

    private var session: URLSession
    private let decoder: JSONDecoder

    /// Cached CSRF token + when it was fetched (short TTL — the session cookie
    /// it's paired with also ages out).
    private var csrfToken: String?
    private var csrfFetchedAt: Date?
    private let csrfTTL: TimeInterval = 20 * 60

    init(session: URLSession = .shared) {
        self.session = session
        let d = JSONDecoder()
        self.decoder = d
    }

    /// Point every request at the WARP-proxied session (or back at `.shared`).
    /// Cookies/CSRF are bound to a session, so swapping it drops the cached
    /// token — the next call re-bootstraps through the new egress.
    func setSession(_ session: URLSession) {
        if session !== self.session { csrfToken = nil; csrfFetchedAt = nil }
        self.session = session
    }

    enum AUError: Error, LocalizedError {
        case network
        case notAuthenticated
        case notFound
        var errorDescription: String? {
            switch self {
            case .network: return "Impossibile contattare AnimeUnity."
            case .notAuthenticated: return "Sessione AnimeUnity non valida."
            case .notFound: return "Contenuto non trovato."
            }
        }
    }

    // MARK: - Catalog

    /// Live search by title.
    func search(query: String) async throws -> [AUAnime] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return [] }
        let data = try await postForm("/livesearch", form: ["title": q])
        return (try? decoder.decode(AURecordsResponse.self, from: data))?.records ?? []
    }

    /// Browse the archive. `offset` paginates 30 at a time. `order` mirrors the
    /// site's options ("Più visti", "Ultime aggiunte", "Popolarità", …).
    func browse(offset: Int = 0, order: String = "Più visti") async throws -> [AUAnime] {
        let body: [String: Any] = [
            "title": false, "type": false, "year": false, "order": order,
            "status": false, "genres": false, "offset": offset,
            "dubbed": false, "season": false,
        ]
        let data = try await postJSON("/archivio/get-animes", body: body)
        return (try? decoder.decode(AURecordsResponse.self, from: data))?.records ?? []
    }

    /// `info_api` caps the episode window at 120 per call (a larger span
    /// returns an empty list), so the detail page pages by window.
    static let episodeChunk = 120

    /// One window of episodes plus the entry's total count (so the UI can build
    /// the "1-120 / 121-240 / …" range selector).
    struct AUEpisodePage: Sendable {
        let episodes: [AUEpisode]
        let total: Int
    }

    /// Fetch a single episode window. `start`/`end` must span ≤ 120.
    func episodePage(animeId: Int, start: Int, end: Int) async throws -> AUEpisodePage {
        guard let url = URL(string: "\(baseURL)/info_api/\(animeId)/1?start_range=\(start)&end_range=\(end)") else {
            throw AUError.network
        }
        let (data, http) = try await get(url, xhr: true)
        guard (200...299).contains(http.statusCode) else { throw AUError.network }
        guard let info = try? decoder.decode(AUInfoResponse.self, from: data) else { throw AUError.notFound }
        return AUEpisodePage(episodes: (info.episodes ?? []).filter { !$0.isHidden },
                             total: info.episodesCount ?? 0)
    }

    // MARK: - Embed → vixcloud

    /// Resolve an AnimeUnity episode id to its vixcloud embed URL (the plaintext
    /// `GET /embed-url/{id}` response). Feed straight into `VixcloudClient`.
    func embedURL(episodeId: Int, animeId: Int, slug: String?) async throws -> String {
        guard let url = URL(string: "\(baseURL)/embed-url/\(episodeId)") else { throw AUError.network }
        let req = makeRequest(url, referer: slug.map { "\(baseURL)/anime/\(animeId)-\($0)" })
        guard let (data, http) = try? await session.data(for: req), let h = http as? HTTPURLResponse,
              (200...299).contains(h.statusCode) else { throw AUError.network }
        let raw = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        guard let parsed = URL(string: raw), parsed.host == "vixcloud.co", parsed.path.hasPrefix("/embed/") else {
            throw AUError.notFound
        }
        return parsed.absoluteString
    }

    /// Raw `/embed-url` response — for verifying the shape on-device.
    func debugEmbedResponse(episodeId: Int) async -> String? {
        guard let url = URL(string: "\(baseURL)/embed-url/\(episodeId)") else { return nil }
        let req = makeRequest(url)
        return (try? await session.data(for: req)).map { String(decoding: $0.0, as: UTF8.self) }
    }

    // MARK: - CSRF bootstrap

    /// Fetch (or reuse) the homepage CSRF token. The paired `animeunity_session`
    /// cookie is captured by the session's cookie storage as a side effect.
    private func csrf() async throws -> String {
        if let t = csrfToken, let at = csrfFetchedAt, Date().timeIntervalSince(at) < csrfTTL { return t }
        guard let url = URL(string: "\(baseURL)/") else { throw AUError.network }
        let req = makeRequest(url, xhr: false)
        guard let (data, http) = try? await session.data(for: req), let h = http as? HTTPURLResponse,
              (200...299).contains(h.statusCode) else { throw AUError.network }
        let html = String(decoding: data, as: UTF8.self)
        guard let token = ProviderClient.firstMatch(in: html, pattern: "<meta name=\"csrf-token\" content=\"([^\"]+)\"") else {
            throw AUError.notAuthenticated
        }
        csrfToken = token
        csrfFetchedAt = Date()
        return token
    }

    private func invalidateCSRF() { csrfToken = nil; csrfFetchedAt = nil }

    // MARK: - HTTP

    private static let userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

    /// Single place that stamps the shared request defaults (timeout, browser
    /// User-Agent, optional XHR + Referer headers). Every endpoint builds on
    /// this so header drift can't creep back in across methods.
    private func makeRequest(_ url: URL, method: String = "GET", xhr: Bool = true, referer: String? = nil) -> URLRequest {
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = requestTimeout
        req.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        if xhr { req.setValue("XMLHttpRequest", forHTTPHeaderField: "X-Requested-With") }
        if let referer { req.setValue(referer, forHTTPHeaderField: "Referer") }
        return req
    }

    private func get(_ url: URL, xhr: Bool) async throws -> (Data, HTTPURLResponse) {
        let req = makeRequest(url, xhr: xhr)
        guard let (data, http) = try? await session.data(for: req), let h = http as? HTTPURLResponse else {
            throw AUError.network
        }
        return (data, h)
    }

    private func postForm(_ path: String, form: [String: String]) async throws -> Data {
        let body = form.map { "\($0.key)=\(Self.urlEncode($0.value))" }.joined(separator: "&")
        return try await post(path, body: Data(body.utf8), contentType: "application/x-www-form-urlencoded; charset=UTF-8")
    }

    private func postJSON(_ path: String, body: [String: Any]) async throws -> Data {
        let data = try JSONSerialization.data(withJSONObject: body)
        return try await post(path, body: data, contentType: "application/json;charset=UTF-8")
    }

    /// POST with CSRF. Retries once after re-bootstrapping the token on a 419
    /// (Laravel "page expired").
    private func post(_ path: String, body: Data, contentType: String) async throws -> Data {
        func attempt() async throws -> (Data, Int) {
            let token = try await csrf()
            guard let url = URL(string: "\(baseURL)\(path)") else { throw AUError.network }
            var req = makeRequest(url, method: "POST", referer: "\(baseURL)/")
            req.httpBody = body
            req.setValue(contentType, forHTTPHeaderField: "Content-Type")
            req.setValue(token, forHTTPHeaderField: "X-CSRF-TOKEN")
            guard let (data, http) = try? await session.data(for: req), let h = http as? HTTPURLResponse else {
                throw AUError.network
            }
            return (data, h.statusCode)
        }

        let (data, status) = try await attempt()
        if status == 419 || status == 401 {
            invalidateCSRF()
            let (retryData, retryStatus) = try await attempt()
            guard (200...299).contains(retryStatus) else { throw AUError.notAuthenticated }
            return retryData
        }
        guard (200...299).contains(status) else { throw AUError.network }
        return data
    }

    private static func urlEncode(_ s: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
    }
}
