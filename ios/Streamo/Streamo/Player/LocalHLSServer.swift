import Foundation
import Network

/// Minimal HTTP/1.1 server on 127.0.0.1 that serves files from
/// `Documents/Downloads/`. Exists to feed downloaded HLS assets to AVPlayer
/// via a loopback URL — AVFoundation's airplane-mode preflight refuses to
/// play local `.movpkg` files (NSURLErrorNotConnectedToInternet -1009) even
/// when the asset cache reports `isPlayableOffline=true`, but it's perfectly
/// happy talking to a localhost server. Supports `Range:` requests so seeking
/// inside a segment works.
final class LocalHLSServer: @unchecked Sendable {
    static let shared = LocalHLSServer()

    private let queue = DispatchQueue(label: "com.streamo.localhls")
    private var listener: NWListener?
    private var readyContinuations: [CheckedContinuation<UInt16, Error>] = []
    private var boundPort: UInt16 = 0

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
        do {
            let params = NWParameters.tcp
            params.allowLocalEndpointReuse = true
            let listener = try NWListener(using: params)
            listener.newConnectionHandler = { [weak self] conn in self?.accept(conn) }
            listener.stateUpdateHandler = { [weak self] state in
                guard let self else { return }
                switch state {
                case .ready:
                    if let port = listener.port { self.boundPort = port.rawValue }
                    for c in self.readyContinuations { c.resume(returning: self.boundPort) }
                    self.readyContinuations.removeAll()
                case .failed(let err):
                    for c in self.readyContinuations { c.resume(throwing: err) }
                    self.readyContinuations.removeAll()
                    self.listener = nil
                    self.boundPort = 0
                default:
                    break
                }
            }
            listener.start(queue: queue)
            self.listener = listener
        } catch {
            for c in readyContinuations { c.resume(throwing: error) }
            readyContinuations.removeAll()
        }
    }

    /// Loopback URL for a file under `Documents/Downloads/<relativePath>`.
    func playbackURL(forRelativePath relativePath: String) async throws -> URL {
        let port = try await ensureRunning()
        guard let url = Self.url(port: port, relativePath: relativePath) else {
            throw ServerError.invalidPath
        }
        return url
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
        let encoded = relativePath
            .split(separator: "/")
            .map { $0.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? String($0) }
            .joined(separator: "/")
        return URL(string: "http://127.0.0.1:\(port)/\(encoded)")
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
        let pathOnly = rawPath.split(separator: "?", maxSplits: 1).map(String.init).first ?? rawPath
        let decoded = pathOnly.removingPercentEncoding ?? pathOnly
        let cleanPath = decoded.hasPrefix("/") ? String(decoded.dropFirst()) : decoded

        // Resolve and contain to documentsRoot.
        let fileURL = documentsRoot.appendingPathComponent(cleanPath).standardizedFileURL
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
        var extraHeaders: [String: String] = [
            "Content-Type": Self.mimeType(forExtension: fileURL.pathExtension),
            "Content-Length": "\(length)",
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
        ]
        if isRange {
            extraHeaders["Content-Range"] = "bytes \(rangeStart)-\(rangeEnd)/\(totalSize)"
        }

        let status = isRange ? "206 Partial Content" : "200 OK"
        sendHeaders(status: status, extra: extraHeaders, on: connection) { [weak self] in
            self?.streamFile(at: fileURL, start: rangeStart, length: length, on: connection)
        }
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
        default: return "application/octet-stream"
        }
    }

    enum ServerError: Error {
        case cancelled
        case invalidPath
    }
}
