import Foundation

/// Identifies what a proxy request is for, sent as `X-Streamo-Client` so the
/// proxy log can tell downloads, streaming and catalog browsing apart.
enum ProxyClient: String, Sendable {
    case download
    case player
    case browse
}

actor ProviderProxyClient {
    static let shared = ProviderProxyClient()

    enum ProxyError: Error, Sendable {
        case invalidConfiguration
        case unauthorized
        case unavailable
    }

    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(session: URLSession = .shared) {
        self.session = session
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        self.decoder = decoder
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        self.encoder = encoder
    }

    struct HealthCheck: Decodable, Sendable {
        let checkedAt: Double
        let ok: Bool
        let warp: Bool
        let colo: String?
        let providerCatalogBaseURL: String?
        let providerReachable: Bool
        let vixcloudReachable: Bool
        let errors: [String]
    }

    struct PlaybackSourcesResult: Sendable {
        let sources: [VixcloudClient.PlaybackSource]
        let reason: ProviderResolveFailureReason?
        let message: String?
    }

    struct ProxyResponse<T> {
        let value: T?
        let error: ProxyError?
    }

    private struct TitleResolveDTO: Decodable {
        struct ResolvedTitleDTO: Decodable {
            let id: Int
            let slug: String?
            let title: String
            let mediaType: MediaType
        }

        let resolved: ResolvedTitleDTO?
        let reason: ProviderResolveFailureReason?
        let candidates: [ProviderCandidate]
        let matchStatus: ProviderMatchStatus?
    }

    private struct PlaybackSourcesDTO: Decodable {
        struct SourceDTO: Decodable {
            let url: String
        }

        let sources: [SourceDTO]
        let reason: ProviderResolveFailureReason?
        let message: String?
    }

    private struct ResolveTitleRequest: Encodable {
        let tmdbId: Int
        let mediaType: MediaType
        let title: String
        let releaseDate: String?
    }

    private struct ResolveEpisodeRequest: Encodable {
        let providerTitleId: Int
        let providerSlug: String?
        let season: Int
        let episode: Int
    }

    private struct ResolveMovieRequest: Encodable {
        let providerTitleId: Int
    }

    func healthCheck() async -> HealthCheck? {
        let response: ProxyResponse<HealthCheck> = await get("health")
        return response.value
    }

    func healthCheckResult() async -> ProxyResponse<HealthCheck> {
        await get("health")
    }

    func resolveTitle(
        tmdbId: Int,
        mediaType: MediaType,
        title: String,
        releaseDate: String?,
        client: ProxyClient
    ) async -> ProviderResolveTitleOutcome {
        let response: ProxyResponse<TitleResolveDTO> = await post("provider/resolve-title", body: ResolveTitleRequest(
            tmdbId: tmdbId,
            mediaType: mediaType,
            title: title,
            releaseDate: releaseDate
        ), client: client)
        guard let dto = response.value else {
            return ProviderResolveTitleOutcome(
                resolved: nil,
                reason: .temporarilyUnavailable,
                candidates: [],
                matchStatus: nil
            )
        }

        let resolved = dto.resolved.map {
            ProviderResolvedTitle(id: $0.id, slug: $0.slug, title: $0.title, mediaType: $0.mediaType)
        }
        return ProviderResolveTitleOutcome(
            resolved: resolved,
            reason: dto.reason,
            candidates: dto.candidates,
            matchStatus: dto.matchStatus
        )
    }

    func resolveEpisodeSources(
        providerTitleId: Int,
        providerSlug: String?,
        season: Int,
        episode: Int,
        client: ProxyClient
    ) async -> PlaybackSourcesResult {
        let dto: ProxyResponse<PlaybackSourcesDTO> = await post("provider/resolve-episode", body: ResolveEpisodeRequest(
            providerTitleId: providerTitleId,
            providerSlug: providerSlug,
            season: season,
            episode: episode
        ), client: client)
        return playbackResult(from: dto)
    }

    func resolveMovieSources(providerTitleId: Int, client: ProxyClient) async -> PlaybackSourcesResult {
        let dto: ProxyResponse<PlaybackSourcesDTO> = await post("provider/resolve-movie", body: ResolveMovieRequest(
            providerTitleId: providerTitleId
        ), client: client)
        return playbackResult(from: dto)
    }

    private func playbackResult(from response: ProxyResponse<PlaybackSourcesDTO>) -> PlaybackSourcesResult {
        guard let dto = response.value else {
            return PlaybackSourcesResult(
                sources: [],
                reason: .temporarilyUnavailable,
                message: response.error == .unauthorized
                    ? "Token proxy non valido."
                    : "Proxy non raggiungibile."
            )
        }

        // AVPlayer must send the proxy bearer on every request (master playlist,
        // sub-playlists, segments, key files). `AVURLAssetHTTPHeaderFieldsKey`
        // propagates these to all sub-resource loads.
        let headers = proxyAuthHeaders()
        let sources = dto.sources.compactMap { source -> VixcloudClient.PlaybackSource? in
            guard let url = URL(string: source.url) else { return nil }
            return VixcloudClient.PlaybackSource(playlistURL: url, headers: headers)
        }

        return PlaybackSourcesResult(
            sources: sources,
            reason: dto.reason,
            message: dto.message
        )
    }

    private func proxyAuthHeaders() -> [String: String] {
        let token = AppSettings.shared.providerProxyToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else { return [:] }
        return ["Authorization": "Bearer \(token)"]
    }

    private func get<T: Decodable>(_ path: String) async -> ProxyResponse<T> {
        guard let url = endpointURL(path) else { return ProxyResponse(value: nil, error: .invalidConfiguration) }
        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        applyAuthHeaders(to: &request)
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return ProxyResponse(value: nil, error: .unavailable)
            }
            if http.statusCode == 401 {
                return ProxyResponse(value: nil, error: .unauthorized)
            }
            guard (200...299).contains(http.statusCode) else {
                return ProxyResponse(value: nil, error: .unavailable)
            }
            return ProxyResponse(value: try decoder.decode(T.self, from: data), error: nil)
        } catch {
            return ProxyResponse(value: nil, error: .unavailable)
        }
    }

    private func post<T: Decodable, Body: Encodable>(_ path: String, body: Body, client: ProxyClient) async -> ProxyResponse<T> {
        guard let url = endpointURL(path) else { return ProxyResponse(value: nil, error: .invalidConfiguration) }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(client.rawValue, forHTTPHeaderField: "X-Streamo-Client")
        applyAuthHeaders(to: &request)
        do {
            request.httpBody = try encoder.encode(body)
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return ProxyResponse(value: nil, error: .unavailable)
            }
            if http.statusCode == 401 {
                return ProxyResponse(value: nil, error: .unauthorized)
            }
            guard (200...299).contains(http.statusCode) else {
                return ProxyResponse(value: nil, error: .unavailable)
            }
            return ProxyResponse(value: try decoder.decode(T.self, from: data), error: nil)
        } catch {
            return ProxyResponse(value: nil, error: .unavailable)
        }
    }

    private func endpointURL(_ path: String) -> URL? {
        guard let base = AppSettings.shared.providerProxyBaseURL else { return nil }
        return path.split(separator: "/").reduce(base) { partial, piece in
            partial.appendingPathComponent(String(piece), isDirectory: false)
        }
    }

    private func applyAuthHeaders(to request: inout URLRequest) {
        let token = AppSettings.shared.providerProxyToken.trimmingCharacters(in: .whitespacesAndNewlines)
        if !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
    }
}
