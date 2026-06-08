import Foundation

/// Turns a vixcloud `/embed/<id>` URL into a directly-playable HLS master
/// playlist URL for AVPlayer. This replaces the web app's nginx playlist proxy
/// + JWPlayer iframe: instead of letting a player inside a webview build the
/// URL, we scrape the embed page and reconstruct it ourselves.
///
/// ⚠️ The embed page is third-party HTML — its exact shape (the
/// `window.masterPlaylist` object, the FHD flag) must be verified at runtime
/// and may change. Extraction is deliberately tolerant (several regex
/// fallbacks). `debugEmbedHTML` returns the raw page so the format can be
/// re-checked on-device.
actor VixcloudClient {
    static let shared = VixcloudClient()

    /// Headers vixcloud expects (the web proxy spoofed these on the playlist).
    static let playbackHeaders: [String: String] = [
        "Referer": "https://vixcloud.co/",
        "Origin": "https://vixcloud.co",
    ]

    private var session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    /// Swap the URLSession used for embed/playlist fetches. `ProviderResolver`
    /// points this at the WARP-proxied session in proxy mode so the embed page
    /// (and thus the device IP) is hidden from vixcloud.
    func setSession(_ session: URLSession) { self.session = session }

    struct PlaybackSource: Sendable {
        let playlistURL: URL
        let headers: [String: String]
    }

    enum VixError: Error, LocalizedError {
        case fetchFailed
        case playlistNotFound
        var errorDescription: String? {
            switch self {
            case .fetchFailed: return "Impossibile contattare il provider video."
            case .playlistNotFound: return "Stream non trovato nella pagina del player."
            }
        }
    }

    /// Resolve an embed URL to an ordered list of playable sources: the master
    /// playlist first, then the alternate servers from `window.streams`. The
    /// player falls back down the list when one fails.
    func playbackSources(embedURL: String) async throws -> [PlaybackSource] {
        guard let html = try? await fetchHTML(embedURL) else { throw VixError.fetchFailed }
        let urls = Self.buildPlaylistURLs(fromEmbedHTML: html)
        guard !urls.isEmpty else { throw VixError.playlistNotFound }
        return urls.map { PlaybackSource(playlistURL: $0, headers: Self.playbackHeaders) }
    }

    /// Raw embed HTML — for verifying the page structure on-device.
    func debugEmbedHTML(embedURL: String) async -> String? {
        try? await fetchHTML(embedURL)
    }

    private func fetchHTML(_ urlString: String) async throws -> String {
        guard let url = URL(string: urlString) else { throw VixError.fetchFailed }
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        request.setValue("text/html,application/xhtml+xml,*/*", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw VixError.fetchFailed
        }
        return String(decoding: data, as: UTF8.self)
    }

    // MARK: - Extraction

    /// Build the HLS master playlist URL from the embed page HTML.
    ///
    /// Vixcloud embed pages expose a JS object roughly like:
    /// ```
    /// window.masterPlaylist = { params: { token: '…', expires: '…' }, url: 'https://vixcloud.co/playlist/<id>' }
    /// window.canPlayFHD = true
    /// ```
    /// We extract `url`, `token`, `expires` (tolerant to quote style) and append
    /// `&h=1` when FHD is allowed. Exposed as `static` so it's unit-testable
    /// against a captured page without hitting the network.
    static func buildPlaylistURL(fromEmbedHTML html: String) -> URL? {
        buildPlaylistURLs(fromEmbedHTML: html).first
    }

    private struct Stream: Decodable { let name: String?; let active: Bool?; let url: String? }

    /// Ordered playable URLs: master playlist first, then alternate servers
    /// from `window.streams` (active ones before inactive), de-duplicated.
    static func buildPlaylistURLs(fromEmbedHTML html: String) -> [URL] {
        let token = extract(html, patterns: [
            "'token'\\s*:\\s*'([^']+)'", "\"token\"\\s*:\\s*\"([^\"]+)\"",
            "token:\\s*'([^']+)'", "token:\\s*\"([^\"]+)\"",
        ])
        let expires = extract(html, patterns: [
            "'expires'\\s*:\\s*'([^']+)'", "\"expires\"\\s*:\\s*\"([^\"]+)\"",
            "expires:\\s*'([^']+)'", "expires:\\s*\"([^\"]+)\"",
        ])
        let canFHD = (extract(html, patterns: ["window\\.canPlayFHD\\s*=\\s*(true|false)"]) == "true")

        func withParams(_ base: String) -> URL? {
            guard var components = URLComponents(string: base.trimmed) else { return nil }
            var items = components.queryItems ?? []
            if let token, !items.contains(where: { $0.name == "token" }) { items.append(.init(name: "token", value: token)) }
            if let expires, !items.contains(where: { $0.name == "expires" }) { items.append(.init(name: "expires", value: expires)) }
            if canFHD, !items.contains(where: { $0.name == "h" }) { items.append(.init(name: "h", value: "1")) }
            components.queryItems = items.isEmpty ? nil : items
            return components.url
        }

        var bases: [String] = []
        // Primary: masterPlaylist.url
        if let master = extract(html, patterns: [
            "url:\\s*'([^']+)'", "url:\\s*\"([^\"]+)\"", "\"url\"\\s*:\\s*\"([^\"]+)\"",
        ]) {
            bases.append(master)
        }
        // Alternates: window.streams (active first), URLs are JSON-escaped.
        // Key sort (active=0, inactive=1) — a valid strict-weak ordering, so
        // it's stable for more than two servers.
        for s in parseStreams(html).sorted(by: { ($0.active ?? false ? 0 : 1) < ($1.active ?? false ? 0 : 1) }) {
            if let u = s.url { bases.append(u.replacingOccurrences(of: "\\/", with: "/")) }
        }

        var seen = Set<String>()
        return bases.compactMap(withParams).filter { seen.insert($0.absoluteString).inserted }
    }

    private static func parseStreams(_ html: String) -> [Stream] {
        guard let regex = try? NSRegularExpression(pattern: "window\\.streams\\s*=\\s*(\\[.*?\\])",
                                                   options: [.caseInsensitive, .dotMatchesLineSeparators]),
              let m = regex.firstMatch(in: html, range: NSRange(html.startIndex..., in: html)),
              m.numberOfRanges > 1, let r = Range(m.range(at: 1), in: html),
              let data = String(html[r]).data(using: .utf8) else { return [] }
        return (try? JSONDecoder().decode([Stream].self, from: data)) ?? []
    }

    private static func extract(_ text: String, patterns: [String]) -> String? {
        for p in patterns {
            if let m = ProviderClient.firstMatch(in: text, pattern: p) { return m }
        }
        return nil
    }
}
