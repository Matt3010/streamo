import Foundation

/// Fetches skip-intro / skip-credits timestamps from TheIntroDB (v3 API).
///
/// Keyed by TMDB id — exactly what `PlaybackRequest` already carries, so no id
/// conversion is needed. Reads are keyless (an API key only raises the rate
/// limit); a missing/failed lookup returns `nil` so the player simply shows no
/// skip button and nothing regresses.
///
/// Anime is intentionally out of scope here: for `.animeUnity` the request's
/// `tmdbId` actually holds the AnimeUnity entry id, not a real TMDB id, so the
/// caller (`PlaybackController`) only queries this client for `.tmdb` sources.
actor IntroSkipClient {
    static let shared = IntroSkipClient()

    /// Segment boundaries in **seconds**. `introStart` is nil when the intro
    /// runs from the very start (movies often report this); `creditsStart` is
    /// nil when there are no credits data.
    struct Segments: Sendable, Equatable {
        var introStart: Double?
        var introEnd: Double?
        var creditsStart: Double?

        /// True when there's nothing actionable — lets the caller drop it.
        var isEmpty: Bool { introEnd == nil && creditsStart == nil }
    }

    private let session: URLSession
    private let requestTimeout: TimeInterval = 8

    init(session: URLSession = .shared) {
        self.session = session
    }

    /// Look up segments for a movie or TV episode. `durationMs` is optional but
    /// recommended: TheIntroDB uses it to pick the matching release cut when a
    /// title has multiple versions.
    func fetch(tmdbId: Int, isMovie: Bool, season: Int, episode: Int, durationMs: Double?) async -> Segments? {
        guard tmdbId > 0 else { return nil }
        var comps = URLComponents(string: "https://api.theintrodb.org/v3/media")!
        var items = [URLQueryItem(name: "tmdb_id", value: String(tmdbId))]
        if !isMovie {
            items.append(URLQueryItem(name: "season", value: String(season)))
            items.append(URLQueryItem(name: "episode", value: String(episode)))
        }
        if let ms = durationMs, ms > 0 {
            items.append(URLQueryItem(name: "duration_ms", value: String(Int(ms))))
        }
        comps.queryItems = items
        guard let url = comps.url else { return nil }

        var request = URLRequest(url: url)
        request.timeoutInterval = requestTimeout
        request.setValue("Streamo/1.0", forHTTPHeaderField: "User-Agent")   // API rejects empty UA
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        guard let (data, response) = try? await session.data(for: request),
              let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
              let decoded = try? JSONDecoder().decode(MediaResponse.self, from: data) else {
            return nil
        }

        func seconds(_ ms: Double?) -> Double? { ms.map { $0 / 1000 } }
        let segments = Segments(
            introStart: seconds(decoded.intro?.first?.startMs),
            introEnd: seconds(decoded.intro?.first?.endMs),
            creditsStart: seconds(decoded.credits?.first?.startMs)
        )
        return segments.isEmpty ? nil : segments
    }

    // MARK: - Wire format

    private struct MediaResponse: Decodable {
        let intro: [Segment]?
        let credits: [Segment]?

        struct Segment: Decodable {
            let startMs: Double?
            let endMs: Double?
            enum CodingKeys: String, CodingKey {
                case startMs = "start_ms"
                case endMs = "end_ms"
            }
        }
    }
}
