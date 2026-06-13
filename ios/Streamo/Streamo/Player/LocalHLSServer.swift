import Foundation
import Network

/// Minimal HTTP/1.1 server on the device that serves files from
/// `Documents/Downloads/`. Exists primarily to feed downloaded HLS assets to
/// AVPlayer via a loopback URL — AVFoundation's airplane-mode preflight
/// refuses to play local `.movpkg` files (NSURLErrorNotConnectedToInternet
/// -1009) even when the asset cache reports `isPlayableOffline=true`, but it
/// talks happily to a localhost server. Supports `Range:` requests so seeking
/// inside a segment works.
///
/// Over the LAN the server only accepts an active AirPlay session: a
/// per-playback token (see `beginAirplaySession`) lets an AirPlay receiver
/// fetch the playing download's files; everything else from a non-loopback
/// peer is rejected.
final class LocalHLSServer: @unchecked Sendable {
    static let shared = LocalHLSServer()

    private let queue = DispatchQueue(label: "com.streamo.localhls")
    private var listener: NWListener?
    private var readyContinuations: [CheckedContinuation<UInt16, Error>] = []
    private var boundPort: UInt16 = 0
    /// Preferred fixed port so the shared LAN URL / QR stay valid across app
    /// launches (an ephemeral port changed every relaunch → stale links).
    private let preferredPort: UInt16 = 50321
    private var usingPreferredPort = false

    /// Password-less, per-playback token that lets an AirPlay receiver (or the
    /// device itself, dialing its own LAN IP) fetch download *files* — never the
    /// browser index / player UI. Set by `beginAirplaySession` when offline
    /// playback starts and cleared by `endAirplaySession` on teardown, so the
    /// asset is only reachable while it's actually playing. `airplayPathPrefix`
    /// scopes the token to the playing item's folder. Both read on `queue`.
    private var airplayToken: String = ""
    private var airplayPathPrefix: String = ""

    /// Auth token for the live-proxy routes (`/playlist`, `/cdn`, …). When the
    /// app plays through the on-device WARP proxy, the rewritten playlist embeds
    /// this as `?key=` on every sub-resource so AirPlay receivers (no headers)
    /// authenticate via the URL alone. Loopback (on-device) is always trusted;
    /// LAN peers must present a matching `key`. Set by `ProviderResolver` when a
    /// proxied session begins. Read on `queue`.
    private var liveProxyToken: String = ""

    /// On-disk root the server reads from. Every download goes under a
    /// per-entry subfolder here.
    let documentsRoot: URL = {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = docs.appendingPathComponent("Downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    private init() {}

    /// Start the listener if not already running. Returns the bound port.
    /// Safe to call repeatedly — subsequent calls return the same port.
    func ensureRunning() async throws -> UInt16 {
        if boundPort != 0 { return boundPort }
        return try await withCheckedThrowingContinuation { cont in
            queue.async { [weak self] in
                guard let self else { cont.resume(throwing: ServerError.cancelled); return }
                if self.boundPort != 0 {
                    cont.resume(returning: self.boundPort)
                    return
                }
                self.readyContinuations.append(cont)
                if self.listener == nil {
                    self.startListenerOnQueue()
                }
            }
        }
    }

    private func startListenerOnQueue() {
        startListenerOnQueue(preferred: true)
    }

    /// Start the listener. `preferred` binds the fixed `preferredPort` (stable
    /// URL); if that port is busy we retry once on an OS-assigned port.
    private func startListenerOnQueue(preferred: Bool) {
        do {
            let params = NWParameters.tcp
            params.allowLocalEndpointReuse = true
            let listener: NWListener
            if preferred, let port = NWEndpoint.Port(rawValue: preferredPort) {
                listener = try NWListener(using: params, on: port)
            } else {
                listener = try NWListener(using: params)
            }
            usingPreferredPort = preferred
            // Advertise over Bonjour: this is what makes iOS show the "Local
            // Network" permission prompt. Without the permission, incoming LAN
            // connections are silently dropped on a regular Wi-Fi (a personal
            // hotspot bypasses this, which is why it works there).
            listener.service = NWListener.Service(name: "Project Obsidian", type: "_http._tcp")
            listener.newConnectionHandler = { [weak self] conn in self?.accept(conn) }
            listener.stateUpdateHandler = { [weak self] state in
                guard let self else { return }
                switch state {
                case .ready:
                    if let port = listener.port { self.boundPort = port.rawValue }
                    for c in self.readyContinuations { c.resume(returning: self.boundPort) }
                    self.readyContinuations.removeAll()
                case .failed(let err):
                    self.listener?.cancel()
                    self.listener = nil
                    self.boundPort = 0
                    if self.usingPreferredPort {
                        // Fixed port unavailable — fall back to a random one.
                        self.startListenerOnQueue(preferred: false)
                    } else {
                        for c in self.readyContinuations { c.resume(throwing: err) }
                        self.readyContinuations.removeAll()
                    }
                default:
                    break
                }
            }
            listener.start(queue: queue)
            self.listener = listener
        } catch {
            if preferred {
                startListenerOnQueue(preferred: false)
            } else {
                for c in readyContinuations { c.resume(throwing: error) }
                readyContinuations.removeAll()
            }
        }
    }

    /// Synchronously waits up to `timeout` for the server to be ready and
    /// returns the bound port (0 on timeout). Safe to call from `MainActor`:
    /// `configure(library:)` warms the server up at launch so this almost
    /// always returns immediately. We poll because the listener's ready
    /// callback fires on a private queue we shouldn't block waiting for.
    func waitForReady(timeout: TimeInterval = 2.0) -> UInt16 {
        if let port = currentBoundPort() { return port }
        // Kick off the bind if it hasn't started yet (idempotent).
        Task.detached { _ = try? await self.ensureRunning() }
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let port = currentBoundPort() { return port }
            Thread.sleep(forTimeInterval: 0.01)
        }
        return 0
    }

    private func currentBoundPort() -> UInt16? {
        let port = queue.sync { boundPort }
        return port == 0 ? nil : port
    }

    /// Build a loopback URL for a known port + path. Static so callers can
    /// construct synchronously after `waitForReady` returns the port.
    static func url(port: UInt16, relativePath: String) -> URL? {
        let encoded = encodePathSegments(relativePath)
        return URL(string: "http://127.0.0.1:\(port)/\(encoded)")
    }

    private static func encodePathSegments(_ relativePath: String) -> String {
        relativePath
            .split(separator: "/")
            .map { $0.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? String($0) }
            .joined(separator: "/")
    }

    // MARK: - AirPlay session

    /// Begin an AirPlay-capable session for a download: rotate to a fresh
    /// password-less token (scoped to `relativePath`'s folder) and return a LAN
    /// URL an AirPlay receiver can reach over Wi-Fi. Returns nil when the device
    /// has no shareable LAN address (offline / cellular-only — AirPlay is
    /// impossible there anyway), so the caller falls back to the loopback URL.
    func beginAirplaySession(relativePath: String) -> URL? {
        guard let host = LANAddress.currentShareableIPv4() else { return nil }
        let port = waitForReady()
        guard port != 0 else { return nil }
        let token = Self.randomToken()
        let prefix = relativePath.lastIndex(of: "/").map { String(relativePath[...$0]) } ?? ""
        queue.sync {
            self.airplayToken = token
            self.airplayPathPrefix = prefix
        }
        let encoded = Self.encodePathSegments(relativePath)
        return URL(string: "http://\(host):\(port)/\(token)/\(encoded)")
    }

    /// Revoke the AirPlay token so the download is no longer reachable over the
    /// LAN. Called on every playback teardown.
    func endAirplaySession() {
        queue.async { [weak self] in
            self?.airplayToken = ""
            self?.airplayPathPrefix = ""
        }
    }

    // MARK: - Live proxy (on-device WARP)

    /// Set (or clear) the live-proxy auth token. Passing "" disables LAN access
    /// to the proxy routes (loopback stays open).
    func setLiveProxyToken(_ token: String) {
        queue.async { [weak self] in self?.liveProxyToken = token }
    }

    /// Map an upstream vixcloud / vix-content URL to the matching on-device
    /// proxy URL, appending the auth `key`, client tag `c` and forced-quality
    /// `q`. `host` nil → loopback (on-device playback); a LAN IP → AirPlay.
    /// Preserves the upstream query (vixcloud signs `token`/`expires`).
    static func liveProxyURL(forUpstream upstream: URL, host: String?, port: UInt16,
                             key: String, client: String, maxHeight: Int) -> URL? {
        guard let proxyPath = proxyPath(forUpstream: upstream) else { return nil }
        let base = host.map { "http://\($0):\(port)" } ?? "http://127.0.0.1:\(port)"
        guard var comps = URLComponents(string: base + proxyPath) else { return nil }
        // Keep the upstream signed query verbatim, then add our params.
        var items = comps.queryItems ?? []
        items.append(URLQueryItem(name: "key", value: key))
        if client != "-" { items.append(URLQueryItem(name: "c", value: client)) }
        if maxHeight > 0 { items.append(URLQueryItem(name: "q", value: String(maxHeight))) }
        comps.queryItems = items
        return comps.url
    }

    /// Forward mapping (upstream URL → proxy path), mirroring the reverse done
    /// by `liveProxyUpstream`. Returns the path + the upstream query string.
    private static func proxyPath(forUpstream upstream: URL) -> String? {
        guard let host = upstream.host else { return nil }
        let path = upstream.path
        let query = upstream.query.map { "?\($0)" } ?? ""
        if host.hasSuffix(".vix-content.net") {
            let sub = String(host.dropLast(".vix-content.net".count))
            return "/cdn/\(sub)\(path)\(query)"
        }
        guard host == "vixcloud.co" else { return nil }
        if path.hasPrefix("/playlist/") || path.hasPrefix("/storage/") { return "\(path)\(query)" }
        if path.hasPrefix("/jwplayer-") || path == "/favicon.ico" { return "\(path)\(query)" }
        return "/vixcloud\(path)\(query)"
    }

    /// 128 bits of CSPRNG (SystemRandomNumberGenerator) as URL-safe hex.
    private static func randomToken() -> String {
        var rng = SystemRandomNumberGenerator()
        let hi = UInt64.random(in: .min ... .max, using: &rng)
        let lo = UInt64.random(in: .min ... .max, using: &rng)
        return String(format: "%016llx%016llx", hi, lo)
    }

    // MARK: - Connection handling

    private func accept(_ connection: NWConnection) {
        connection.start(queue: queue)
        receiveRequest(on: connection, accumulated: Data())
    }

    /// Read until the request headers terminate (\r\n\r\n). The body of GET
    /// requests is empty, so once we have the headers we have the whole thing.
    private func receiveRequest(on connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16 * 1024) { [weak self] data, _, _, error in
            guard let self else { connection.cancel(); return }
            if error != nil { connection.cancel(); return }
            var buf = accumulated
            if let data { buf.append(data) }
            if let headerEnd = buf.range(of: Data("\r\n\r\n".utf8)) {
                let headerData = buf.subdata(in: 0..<headerEnd.lowerBound)
                let headerString = String(data: headerData, encoding: .utf8) ?? ""
                self.handle(headers: headerString, on: connection)
            } else if buf.count < 32 * 1024 {
                self.receiveRequest(on: connection, accumulated: buf)
            } else {
                self.send(status: "400 Bad Request", on: connection, then: { connection.cancel() })
            }
        }
    }

    private func handle(headers: String, on connection: NWConnection) {
        let lines = headers.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else {
            send(status: "400 Bad Request", on: connection, then: { connection.cancel() })
            return
        }
        let parts = requestLine.split(separator: " ", maxSplits: 2, omittingEmptySubsequences: true)
        guard parts.count >= 2, parts[0] == "GET" else {
            send(status: "405 Method Not Allowed", on: connection, then: { connection.cancel() })
            return
        }
        let rawPath = String(parts[1])
        let pathAndQuery = rawPath.split(separator: "?", maxSplits: 1).map(String.init)
        let pathOnly = pathAndQuery.first ?? rawPath
        let query = pathAndQuery.count > 1 ? pathAndQuery[1] : ""
        let decoded = pathOnly.removingPercentEncoding ?? pathOnly
        let cleanPath = decoded.hasPrefix("/") ? String(decoded.dropFirst()) : decoded

        // Loopback gets unrestricted access; a non-loopback peer is only let in
        // by an active AirPlay session (token as the first path segment, which
        // we strip before mapping to disk).
        let loopback = isLoopback(connection)

        // Live-proxy routes take precedence (on-device WARP egress). They use a
        // `?key=` query token for non-loopback (AirPlay) auth — not the path
        // token used for download files — so handle them before the file logic.
        // `rawCleanPath` keeps the percent-encoded tail so vixcloud signatures
        // and segment names pass through untouched.
        let rawCleanPath = pathOnly.hasPrefix("/") ? String(pathOnly.dropFirst()) : pathOnly
        if let upstream = Self.liveProxyUpstream(forPath: rawCleanPath, query: query) {
            let params = Self.parseQuery(query)
            let authorized = loopback || (!liveProxyToken.isEmpty && params["key"] == liveProxyToken)
            guard authorized else {
                send(status: "401 Unauthorized", on: connection, then: { connection.cancel() })
                return
            }
            handleLiveProxy(upstream: upstream,
                            forceHeight: params["q"].flatMap { Int($0) } ?? 0,
                            client: params["c"] ?? "-",
                            requestLines: lines, on: connection)
            return
        }

        let resolvedPath: String
        if loopback {
            resolvedPath = cleanPath
        } else {
            // The only non-loopback access allowed is an active AirPlay session:
            // it presents the per-playback token as the first path segment and
            // may fetch download files only, scoped to the playing item's folder.
            let segments = cleanPath.split(separator: "/", omittingEmptySubsequences: false)
            let first = segments.first.map(String.init) ?? ""
            guard !airplayToken.isEmpty, first == airplayToken else {
                send(status: "403 Forbidden", on: connection, then: { connection.cancel() })
                return
            }
            let rest = segments.dropFirst().joined(separator: "/")
            guard airplayPathPrefix.isEmpty || rest.hasPrefix(airplayPathPrefix) else {
                send(status: "403 Forbidden", on: connection, then: { connection.cancel() })
                return
            }
            resolvedPath = rest
        }

        // Resolve and contain to documentsRoot.
        let fileURL = documentsRoot.appendingPathComponent(resolvedPath).standardizedFileURL
        let rootPath = documentsRoot.standardizedFileURL.path
        guard fileURL.path.hasPrefix(rootPath + "/") || fileURL.path == rootPath else {
            send(status: "403 Forbidden", on: connection, then: { connection.cancel() })
            return
        }

        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: fileURL.path, isDirectory: &isDir), !isDir.boolValue else {
            send(status: "404 Not Found", on: connection, then: { connection.cancel() })
            return
        }

        guard let attrs = try? FileManager.default.attributesOfItem(atPath: fileURL.path),
              let totalSize = (attrs[.size] as? NSNumber)?.int64Value else {
            send(status: "500 Internal Server Error", on: connection, then: { connection.cancel() })
            return
        }

        // Parse a Range header if present.
        var rangeStart: Int64 = 0
        var rangeEnd: Int64 = totalSize - 1
        var isRange = false
        for line in lines.dropFirst() {
            if line.lowercased().hasPrefix("range:") {
                let spec = line.dropFirst("range:".count).trimmingCharacters(in: .whitespaces)
                guard spec.hasPrefix("bytes=") else { continue }
                let pair = spec.dropFirst("bytes=".count).split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
                if !pair.isEmpty, let s = Int64(pair[0]) {
                    rangeStart = s
                    if pair.count > 1, let e = Int64(pair[1]), e >= s {
                        rangeEnd = min(e, totalSize - 1)
                    } else {
                        rangeEnd = totalSize - 1
                    }
                    isRange = true
                }
                break
            }
        }
        if rangeStart < 0 || rangeStart > rangeEnd || rangeStart >= totalSize {
            send(status: "416 Range Not Satisfiable", on: connection,
                 extra: ["Content-Range": "bytes */\(totalSize)"],
                 then: { connection.cancel() })
            return
        }

        let length = rangeEnd - rangeStart + 1
        // Treat "Range covers the whole file" as a normal 200 — Chrome adds
        // `Range: bytes=0-` to most media requests, and a few HLS clients
        // misbehave when manifest responses come back as 206.
        let partial = isRange && (rangeStart != 0 || rangeEnd != totalSize - 1)
        var extraHeaders: [String: String] = [
            "Content-Type": Self.mimeType(forExtension: fileURL.pathExtension),
            "Content-Length": "\(length)",
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
        ]
        if partial {
            extraHeaders["Content-Range"] = "bytes \(rangeStart)-\(rangeEnd)/\(totalSize)"
        }

        let status = partial ? "206 Partial Content" : "200 OK"
        sendHeaders(status: status, extra: extraHeaders, on: connection) { [weak self] in
            self?.streamFile(at: fileURL, start: rangeStart, length: length, on: connection)
        }
    }

    /// Determine if the remote endpoint is on the loopback interface
    /// (127.0.0.0/8 or ::1). Anything else is treated as a LAN peer.
    private func isLoopback(_ connection: NWConnection) -> Bool {
        guard case let .hostPort(host, _) = connection.endpoint else { return false }
        switch host {
        case .ipv4(let addr):
            return addr.rawValue.first == 127
        case .ipv6(let addr):
            // IPv4-mapped loopback (::ffff:127.x.x.x) and the canonical ::1.
            let bytes = Array(addr.rawValue)
            if bytes.count == 16, bytes[0..<10].allSatisfy({ $0 == 0 }),
               bytes[10] == 0xff, bytes[11] == 0xff, bytes[12] == 127 { return true }
            if bytes == Array(repeating: 0, count: 15) + [1] { return true }
            return false
        default:
            return false
        }
    }

    private static func parseQuery(_ query: String) -> [String: String] {
        var out: [String: String] = [:]
        for pair in query.split(separator: "&") {
            let kv = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard kv.count == 2 else { continue }
            let k = String(kv[0]).removingPercentEncoding ?? String(kv[0])
            let v = String(kv[1]).removingPercentEncoding ?? String(kv[1])
            out[k] = v
        }
        return out
    }

    /// Stream a (possibly partial) file via 64KB chunks, then close.
    private func streamFile(at url: URL, start: Int64, length: Int64, on connection: NWConnection) {
        guard let handle = try? FileHandle(forReadingFrom: url) else {
            connection.cancel()
            return
        }
        do { try handle.seek(toOffset: UInt64(start)) }
        catch { try? handle.close(); connection.cancel(); return }
        sendChunks(handle: handle, remaining: length, on: connection)
    }

    private func sendChunks(handle: FileHandle, remaining: Int64, on connection: NWConnection) {
        if remaining <= 0 {
            try? handle.close()
            connection.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in
                connection.cancel()
            })
            return
        }
        let chunkSize = Int(min(remaining, 64 * 1024))
        let data: Data
        do { data = try handle.read(upToCount: chunkSize) ?? Data() }
        catch { try? handle.close(); connection.cancel(); return }
        if data.isEmpty {
            try? handle.close()
            connection.cancel()
            return
        }
        connection.send(content: data, completion: .contentProcessed { [weak self] err in
            if err != nil { try? handle.close(); connection.cancel(); return }
            self?.sendChunks(handle: handle, remaining: remaining - Int64(data.count), on: connection)
        })
    }

    private func send(status: String, on connection: NWConnection,
                      extra: [String: String] = [:],
                      then: @escaping () -> Void) {
        let body = "\(status)\n"
        let bodyData = body.data(using: .utf8) ?? Data()
        var headers = "HTTP/1.1 \(status)\r\n"
        for (k, v) in extra { headers += "\(k): \(v)\r\n" }
        headers += "Content-Length: \(bodyData.count)\r\n"
        headers += "Connection: close\r\n\r\n"
        var out = Data(headers.utf8)
        out.append(bodyData)
        connection.send(content: out, contentContext: .finalMessage, isComplete: true,
                        completion: .contentProcessed { _ in then() })
    }

    private func sendHeaders(status: String, extra: [String: String], on connection: NWConnection, then: @escaping () -> Void) {
        var headers = "HTTP/1.1 \(status)\r\n"
        for (k, v) in extra { headers += "\(k): \(v)\r\n" }
        headers += "Connection: close\r\n\r\n"
        connection.send(content: Data(headers.utf8), completion: .contentProcessed { err in
            if err != nil { connection.cancel(); return }
            then()
        })
    }

    // MARK: - Live proxy request handling

    private struct ProxyUpstream: Sendable { let url: String; let kind: ProxyKind }
    private enum ProxyKind: Sendable { case playlist, auto, other }

    /// Reverse of `liveProxyURL`: proxy path → upstream URL. Strips our internal
    /// params (key/c/q), preserving the rest byte-for-byte (vixcloud signs
    /// token/expires). Returns nil for non-proxy paths.
    private static func liveProxyUpstream(forPath path: String, query: String) -> ProxyUpstream? {
        let suffix = querySuffix(query)
        if path == "favicon.ico" { return ProxyUpstream(url: "https://vixcloud.co/favicon.ico\(suffix)", kind: .other) }
        if path.hasPrefix("playlist/") {
            return ProxyUpstream(url: "https://vixcloud.co/\(path)\(suffix)", kind: .playlist)
        }
        if path.hasPrefix("cdn/") {
            let rest = String(path.dropFirst("cdn/".count))
            guard let slash = rest.firstIndex(of: "/") else { return nil }
            let sub = String(rest[..<slash])
            let tail = String(rest[rest.index(after: slash)...])
            guard !sub.isEmpty, sub.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" }) else { return nil }
            return ProxyUpstream(url: "https://\(sub).vix-content.net/\(tail)\(suffix)", kind: .auto)
        }
        if path.hasPrefix("storage/") {
            return ProxyUpstream(url: "https://vixcloud.co/\(path)\(suffix)", kind: .auto)
        }
        if path.hasPrefix("jwplayer-") {
            return ProxyUpstream(url: "https://vixcloud.co/\(path)\(suffix)", kind: .other)
        }
        if path.hasPrefix("vixcloud/") {
            let tail = String(path.dropFirst("vixcloud/".count))
            return ProxyUpstream(url: "https://vixcloud.co/\(tail)\(suffix)", kind: .auto)
        }
        return nil
    }

    /// Keep every query param except our internal key/c/q, byte-for-byte.
    private static func querySuffix(_ query: String) -> String {
        guard !query.isEmpty else { return "" }
        let internalKeys: Set<String> = ["key", "c", "q"]
        let kept = query.split(separator: "&").filter { pair in
            guard !pair.isEmpty else { return false }
            let name = pair.split(separator: "=", maxSplits: 1).first.map(String.init) ?? String(pair)
            return !internalKeys.contains(name)
        }
        return kept.isEmpty ? "" : "?" + kept.joined(separator: "&")
    }

    /// Fetch the upstream through the WARP tunnel session and relay it.
    /// Playlists are rewritten (proxy-relative URLs + auth) and optionally
    /// quality-capped; everything else is passed through. The whole response is
    /// buffered — playlists are tiny and media segments are a few MB, matching
    /// the former Node proxy's per-segment behaviour.
    private func handleLiveProxy(upstream: ProxyUpstream, forceHeight: Int, client: String,
                                 requestLines: [String], on connection: NWConnection) {
        guard let url = URL(string: upstream.url) else {
            send(status: "502 Bad Gateway", on: connection, then: { connection.cancel() })
            return
        }
        let token = liveProxyToken
        let rangeHeader = Self.headerValue("range", in: requestLines)
        let acceptHeader = Self.headerValue("accept", in: requestLines) ?? "*/*"

        Task { [weak self] in
            guard let self else { connection.cancel(); return }
            var request = URLRequest(url: url)
            request.timeoutInterval = 30
            request.setValue(acceptHeader, forHTTPHeaderField: "Accept")
            request.setValue("https://vixcloud.co", forHTTPHeaderField: "Origin")
            // Forward Range only for media (segments) — a playlist must come back
            // whole (200) so the rewrite sees the full manifest.
            if let rangeHeader, upstream.kind != .playlist {
                request.setValue(rangeHeader, forHTTPHeaderField: "Range")
            }

            func fetch() async -> (Data, HTTPURLResponse)? {
                let session = await WarpTunnel.shared.warpSession()
                guard let (data, response) = try? await session.data(for: request),
                      let http = response as? HTTPURLResponse else { return nil }
                return (data, http)
            }

            // First attempt; if it fails while WARP is meant to be up, the tunnel
            // probably went stale (e.g. the app was suspended mid-stream) — flag
            // it, let start() restart it, and retry once before giving up.
            var result = await fetch()
            if result == nil, await WarpTunnel.shared.isReady {
                await WarpTunnel.shared.invalidate()
                _ = try? await WarpTunnel.shared.start()
                result = await fetch()
            }
            guard let (data, http) = result else {
                self.queue.async { self.send(status: "502 Bad Gateway", on: connection, then: { connection.cancel() }) }
                return
            }
            let contentType = (http.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased()
            let isPlaylist = upstream.kind == .playlist
                || (upstream.kind == .auto && (contentType.contains("mpegurl") || contentType.contains("m3u8") || url.path.hasSuffix(".m3u8")))
            let statusLine = "\(http.statusCode) \(HTTPURLResponse.localizedString(forStatusCode: http.statusCode))"

            if isPlaylist {
                var body = String(decoding: data, as: UTF8.self)
                if forceHeight > 0 { body = HLSProxyRewriter.filterMasterToHeight(body, maxHeight: forceHeight) }
                body = HLSProxyRewriter.rewritePlaylist(body, token: token, client: client)
                let out = Data(body.utf8)
                let headers: [String: String] = [
                    "Content-Type": "application/vnd.apple.mpegurl",
                    "Cache-Control": http.value(forHTTPHeaderField: "Cache-Control") ?? "no-store",
                ]
                self.queue.async { self.sendData(statusLine: statusLine, headers: headers, data: out, on: connection) }
            } else {
                var headers: [String: String] = [:]
                for name in ["Content-Type", "Cache-Control", "ETag", "Last-Modified", "Expires", "Accept-Ranges", "Content-Range"] {
                    if let v = http.value(forHTTPHeaderField: name) { headers[name] = v }
                }
                if headers["Content-Type"] == nil { headers["Content-Type"] = "application/octet-stream" }
                self.queue.async { self.sendData(statusLine: statusLine, headers: headers, data: data, on: connection) }
            }
        }
    }

    /// Case-insensitive HTTP header lookup over the raw request lines (skips the
    /// request line). Returns the trimmed value, or nil.
    private static func headerValue(_ name: String, in lines: [String]) -> String? {
        let prefix = name.lowercased() + ":"
        guard let line = lines.dropFirst().first(where: { $0.lowercased().hasPrefix(prefix) }) else { return nil }
        return String(line.drop(while: { $0 != ":" }).dropFirst()).trimmingCharacters(in: .whitespaces)
    }

    /// Send a full in-memory response (own Content-Length) then close.
    private func sendData(statusLine: String, headers: [String: String], data: Data, on connection: NWConnection) {
        var h = "HTTP/1.1 \(statusLine)\r\n"
        for (k, v) in headers { h += "\(k): \(v)\r\n" }
        h += "Content-Length: \(data.count)\r\n"
        h += "Connection: close\r\n\r\n"
        var out = Data(h.utf8)
        out.append(data)
        connection.send(content: out, contentContext: .finalMessage, isComplete: true,
                        completion: .contentProcessed { _ in connection.cancel() })
    }

    // MARK: - Helpers

    private static func mimeType(forExtension ext: String) -> String {
        switch ext.lowercased() {
        case "m3u8", "m3u": return "application/vnd.apple.mpegurl"
        case "ts": return "video/mp2t"
        case "m4s", "mp4", "m4a", "m4v": return "video/mp4"
        case "aac": return "audio/aac"
        case "vtt": return "text/vtt"
        case "webvtt": return "text/vtt"
        case "key", "bin": return "application/octet-stream"
        case "html", "htm": return "text/html; charset=utf-8"
        case "js": return "application/javascript; charset=utf-8"
        default: return "application/octet-stream"
        }
    }

    enum ServerError: Error {
        case cancelled
        case invalidPath
    }
}
