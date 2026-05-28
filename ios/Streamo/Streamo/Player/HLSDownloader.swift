import Foundation

/// Download an HLS asset (master + variants + segments + AES keys) to a
/// directory of plain files, with playlist URIs rewritten to local names.
/// Replaces `AVAssetDownloadTask` — we need full control because vixcloud
/// requires custom Referer/Origin headers and AVFoundation's offline player
/// refuses to play the resulting `.movpkg` in airplane mode.
///
/// Resume works for free: existing segment files are skipped on re-entry.
enum HLSDownloader {
    enum DownloadError: Error, LocalizedError {
        case fetchFailed(URL, Int?)
        case emptyMaster
        var errorDescription: String? {
            switch self {
            case .fetchFailed(let url, let code):
                return "Download non riuscito (\(code.map(String.init) ?? "n/a")) \(url.host ?? "")"
            case .emptyMaster:
                return "Playlist master vuota o non valida"
            }
        }
    }

    /// Progress reported as a 0…1 fraction of segments completed (we don't
    /// know byte totals up-front and segments are roughly uniform per track).
    typealias ProgressHandler = @Sendable (Double) -> Void

    /// Run the download. Honours `Task` cancellation between segments.
    static func download(masterURL: URL,
                         headers: [String: String],
                         outputDirectory: URL,
                         session: URLSession = .shared,
                         progress: @escaping ProgressHandler) async throws {
        try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)

        // 1. Master playlist
        let masterText = try await fetchString(masterURL, headers: headers, session: session)
        var masterLines = masterText.components(separatedBy: "\n")

        // Pre-pass: identify every video variant (`#EXT-X-STREAM-INF` + URI
        // line) and keep only the one with the highest BANDWIDTH. Downloading
        // every quality would multiply data + time by 3-4×; AVPlayer only
        // needs one variant for offline. Other variant blocks are blanked.
        var variantBlocks: [(infIndex: Int, uriIndex: Int, bandwidth: Int)] = []
        do {
            var i = 0
            while i < masterLines.count {
                let line = masterLines[i].trimmingCharacters(in: .whitespaces)
                if line.hasPrefix("#EXT-X-STREAM-INF") {
                    let bw = bandwidthAttribute(line) ?? 0
                    var k = i + 1
                    while k < masterLines.count {
                        let next = masterLines[k].trimmingCharacters(in: .whitespaces)
                        if next.isEmpty || next.hasPrefix("#") { k += 1; continue }
                        variantBlocks.append((i, k, bw))
                        i = k + 1
                        break
                    }
                    if k >= masterLines.count { i = k }
                } else {
                    i += 1
                }
            }
        }
        if variantBlocks.count > 1, let best = variantBlocks.max(by: { $0.bandwidth < $1.bandwidth }) {
            for block in variantBlocks where block.uriIndex != best.uriIndex {
                masterLines[block.infIndex] = ""
                masterLines[block.uriIndex] = ""
            }
        }

        var subPlaylists: [(absoluteURL: URL, localName: String)] = []
        var trackIndex = 0

        for i in 0..<masterLines.count {
            let raw = masterLines[i]
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("#EXT-X-MEDIA") {
                if let uri = extractURIAttribute(line) {
                    trackIndex += 1
                    let resolved = resolveURL(uri, relativeTo: masterURL)
                    let localName = "track-\(trackIndex).m3u8"
                    subPlaylists.append((resolved, localName))
                    masterLines[i] = replaceURIAttribute(line, with: localName)
                }
            } else if line.hasPrefix("#EXT-X-I-FRAME-STREAM-INF"), let uri = extractURIAttribute(line) {
                trackIndex += 1
                let resolved = resolveURL(uri, relativeTo: masterURL)
                let localName = "track-\(trackIndex).m3u8"
                subPlaylists.append((resolved, localName))
                masterLines[i] = replaceURIAttribute(line, with: localName)
            } else if !line.isEmpty && !line.hasPrefix("#") {
                // Variant URI line (kept video variant only — others are "" now).
                trackIndex += 1
                let resolved = resolveURL(line, relativeTo: masterURL)
                let localName = "track-\(trackIndex).m3u8"
                subPlaylists.append((resolved, localName))
                masterLines[i] = localName
            }
        }

        if subPlaylists.isEmpty {
            // Master IS the variant playlist (single-stream case). Treat it
            // as one sub-playlist by reusing the master text directly.
            try await downloadVariant(text: masterText,
                                      sourceURL: masterURL,
                                      trackPrefix: "t1",
                                      headers: headers,
                                      outputDirectory: outputDirectory,
                                      session: session,
                                      progressBase: 0, progressSpan: 1,
                                      progress: progress,
                                      writeAs: "master.m3u8")
            progress(1)
            return
        }

        // 2. Fetch + rewrite + download each sub-playlist sequentially. We
        // distribute progress evenly across sub-playlists.
        let span = 1.0 / Double(subPlaylists.count)
        for (idx, sub) in subPlaylists.enumerated() {
            try Task.checkCancellation()
            let subText = try await fetchString(sub.absoluteURL, headers: headers, session: session)
            try await downloadVariant(text: subText,
                                      sourceURL: sub.absoluteURL,
                                      trackPrefix: "t\(idx + 1)",
                                      headers: headers,
                                      outputDirectory: outputDirectory,
                                      session: session,
                                      progressBase: Double(idx) * span,
                                      progressSpan: span,
                                      progress: progress,
                                      writeAs: sub.localName)
        }

        // 3. Save the rewritten master last so a partial download never leaves
        // a master pointing at not-yet-saved tracks.
        let masterOut = outputDirectory.appendingPathComponent("master.m3u8")
        try masterLines.joined(separator: "\n").write(to: masterOut, atomically: true, encoding: .utf8)
        progress(1)
    }

    // MARK: - Variant

    private static func downloadVariant(text: String,
                                        sourceURL: URL,
                                        trackPrefix: String,
                                        headers: [String: String],
                                        outputDirectory: URL,
                                        session: URLSession,
                                        progressBase: Double,
                                        progressSpan: Double,
                                        progress: @escaping ProgressHandler,
                                        writeAs filename: String) async throws {
        var lines = text.components(separatedBy: "\n")
        var keyDownloads: [(absoluteURL: URL, localName: String)] = []
        var segmentDownloads: [(absoluteURL: URL, localName: String)] = []
        var keyCounter = 0
        var segCounter = 0

        for i in 0..<lines.count {
            let raw = lines[i]
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("#EXT-X-KEY") || line.hasPrefix("#EXT-X-SESSION-KEY") || line.hasPrefix("#EXT-X-MAP") {
                if let uri = extractURIAttribute(line) {
                    keyCounter += 1
                    let resolved = resolveURL(uri, relativeTo: sourceURL)
                    let ext = inferExtension(from: resolved, fallback: line.hasPrefix("#EXT-X-MAP") ? "mp4" : "key")
                    let localName = "\(trackPrefix)-k\(keyCounter).\(ext)"
                    keyDownloads.append((resolved, localName))
                    lines[i] = replaceURIAttribute(line, with: localName)
                }
            } else if !line.isEmpty && !line.hasPrefix("#") {
                segCounter += 1
                let resolved = resolveURL(line, relativeTo: sourceURL)
                let ext = inferExtension(from: resolved, fallback: "ts")
                let localName = "\(trackPrefix)-s\(String(format: "%05d", segCounter)).\(ext)"
                segmentDownloads.append((resolved, localName))
                lines[i] = localName
            }
        }

        // Save rewritten sub-playlist immediately so partials are still
        // structurally valid on resume.
        let out = outputDirectory.appendingPathComponent(filename)
        try lines.joined(separator: "\n").write(to: out, atomically: true, encoding: .utf8)

        // Keys are small but mandatory — fetch them all first, sequentially.
        for (url, name) in keyDownloads {
            try Task.checkCancellation()
            let target = outputDirectory.appendingPathComponent(name)
            if FileManager.default.fileExists(atPath: target.path) { continue }
            let data = try await fetchData(url, headers: headers, session: session)
            try data.write(to: target, options: .atomic)
        }

        // Segments in parallel with bounded concurrency. Mirrors what
        // AVAssetDownloadTask does internally — modern HLS players pipeline
        // 4-8 segment fetches. We sit at 6 to balance throughput against
        // hitting per-token connection limits on vixcloud.
        let total = max(1, segmentDownloads.count)
        let maxConcurrent = 6
        let counter = SegmentCounter()
        try await withThrowingTaskGroup(of: Void.self) { group in
            var index = 0
            func enqueue() {
                guard index < segmentDownloads.count else { return }
                let (url, name) = segmentDownloads[index]
                index += 1
                group.addTask {
                    try Task.checkCancellation()
                    let target = outputDirectory.appendingPathComponent(name)
                    if !FileManager.default.fileExists(atPath: target.path) {
                        let data = try await fetchData(url, headers: headers, session: session)
                        try data.write(to: target, options: .atomic)
                    }
                    let done = await counter.increment()
                    progress(progressBase + progressSpan * Double(done) / Double(total))
                }
            }
            for _ in 0..<min(maxConcurrent, segmentDownloads.count) { enqueue() }
            while try await group.next() != nil { enqueue() }
        }
    }

    /// Tiny actor-backed counter for thread-safe progress reporting across
    /// the parallel segment task group.
    private actor SegmentCounter {
        var done = 0
        func increment() -> Int { done += 1; return done }
    }

    // MARK: - Networking

    private static func fetchString(_ url: URL, headers: [String: String], session: URLSession) async throws -> String {
        let data = try await fetchData(url, headers: headers, session: session)
        guard let text = String(data: data, encoding: .utf8), !text.isEmpty else {
            throw DownloadError.emptyMaster
        }
        return text
    }

    private static func fetchData(_ url: URL, headers: [String: String], session: URLSession) async throws -> Data {
        var request = URLRequest(url: url)
        for (k, v) in headers { request.setValue(v, forHTTPHeaderField: k) }
        request.timeoutInterval = 30
        let (data, response) = try await session.data(for: request)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw DownloadError.fetchFailed(url, http.statusCode)
        }
        return data
    }

    // MARK: - URI parsing helpers

    /// Extract the `URI="..."` attribute value from an HLS tag line.
    private static func extractURIAttribute(_ line: String) -> String? {
        guard let range = line.range(of: "URI=\"") else { return nil }
        let afterQuote = line[range.upperBound...]
        guard let end = afterQuote.firstIndex(of: "\"") else { return nil }
        return String(afterQuote[..<end])
    }

    /// Replace the existing `URI="..."` value with `newValue` (re-quoted).
    private static func replaceURIAttribute(_ line: String, with newValue: String) -> String {
        guard let openRange = line.range(of: "URI=\"") else { return line }
        let afterQuote = line[openRange.upperBound...]
        guard let endRelative = afterQuote.firstIndex(of: "\"") else { return line }
        let endIndex = endRelative
        var rewritten = line
        rewritten.replaceSubrange(openRange.upperBound..<endIndex, with: newValue)
        return rewritten
    }

    /// Extract the integer `BANDWIDTH=N` attribute from a `#EXT-X-STREAM-INF`.
    private static func bandwidthAttribute(_ line: String) -> Int? {
        guard let range = line.range(of: "BANDWIDTH=") else { return nil }
        let after = line[range.upperBound...]
        let digits = after.prefix(while: { $0.isNumber })
        return Int(digits)
    }

    private static func resolveURL(_ candidate: String, relativeTo base: URL) -> URL {
        if let absolute = URL(string: candidate), absolute.scheme != nil { return absolute }
        return URL(string: candidate, relativeTo: base)?.absoluteURL ?? base
    }

    /// Pick a reasonable file extension for an URL (segments/keys may carry
    /// query strings or no extension at all).
    private static func inferExtension(from url: URL, fallback: String) -> String {
        let ext = url.pathExtension
        if !ext.isEmpty, ext.count <= 5, !ext.contains("?") { return ext }
        return fallback
    }
}
