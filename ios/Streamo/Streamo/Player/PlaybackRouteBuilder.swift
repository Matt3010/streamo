import Foundation

struct PlaybackRoute {
    let url: URL
    let assetOptions: [String: Any]?
    let allowsExternalPlayback: Bool
    let usingLAN: Bool
    let isOffline: Bool
    let maxHeight: Int
}

enum PlaybackRouteBuilder {
    @MainActor
    static func route(
        for request: PlaybackRequest,
        source: VixcloudClient.PlaybackSource,
        loopbackForced: Bool,
        maxHeight: Int = AppSettings.shared.streamingMaxHeight
    ) -> PlaybackRoute {
        let isOffline = request.offlineURL != nil
        let assetOptions = Self.assetOptions(for: source, isOffline: isOffline)
        var usingLAN = false
        let url: URL

        if isOffline {
            url = offlineURL(for: request, source: source, loopbackForced: loopbackForced, usingLAN: &usingLAN)
        } else {
            url = streamingURL(for: source.playlistURL, loopbackForced: loopbackForced, maxHeight: maxHeight, usingLAN: &usingLAN)
        }

        let externalAllowed = (isOffline || isLocalProxyURL(source.playlistURL)) ? usingLAN : true
        return PlaybackRoute(
            url: url,
            assetOptions: assetOptions,
            allowsExternalPlayback: externalAllowed,
            usingLAN: usingLAN,
            isOffline: isOffline,
            maxHeight: maxHeight
        )
    }

    private static func assetOptions(
        for source: VixcloudClient.PlaybackSource,
        isOffline: Bool
    ) -> [String: Any]? {
        guard !isOffline else { return nil }
        var streamHeaders = source.headers
        streamHeaders["X-Streamo-Client"] = "player"
        return ["AVURLAssetHTTPHeaderFieldsKey": streamHeaders]
    }

    @MainActor
    private static func offlineURL(
        for request: PlaybackRequest,
        source: VixcloudClient.PlaybackSource,
        loopbackForced: Bool,
        usingLAN: inout Bool
    ) -> URL {
        guard let loopback = request.offlineURL else { return source.playlistURL }
        if !loopbackForced,
           let relPath = offlineRelativePath(from: loopback),
           let lanURL = LocalHLSServer.shared.beginAirplaySession(relativePath: relPath) {
            usingLAN = true
            return lanURL
        }
        return loopback
    }

    private static func streamingURL(
        for playlistURL: URL,
        loopbackForced: Bool,
        maxHeight: Int,
        usingLAN: inout Bool
    ) -> URL {
        guard isLocalProxyURL(playlistURL) else { return playlistURL }
        var base = playlistURL
        if !loopbackForced, let lan = lanVariant(of: playlistURL) {
            base = lan
            usingLAN = true
        }
        var extra = ["c": "player"]
        if maxHeight > 0 { extra["q"] = String(maxHeight) }
        return appendingQuery(extra, on: base)
    }

    private static func offlineRelativePath(from url: URL) -> String? {
        let path = url.path
        let trimmed = path.hasPrefix("/") ? String(path.dropFirst()) : path
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func lanVariant(of url: URL) -> URL? {
        guard let host = LANAddress.currentShareableIPv4(),
              var comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        comps.host = host
        return comps.url
    }

    static func isLocalProxyURL(_ url: URL) -> Bool {
        url.host == "127.0.0.1"
    }

    private static func appendingQuery(_ extra: [String: String], on url: URL) -> URL {
        guard var comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        var items = comps.queryItems ?? []
        for (name, value) in extra where !items.contains(where: { $0.name == name }) {
            items.append(URLQueryItem(name: name, value: value))
        }
        comps.queryItems = items
        return comps.url ?? url
    }
}
