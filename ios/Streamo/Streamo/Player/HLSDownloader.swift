import Foundation

/// Download an HLS asset (master + variants + segments + AES keys) to a
/// directory of plain files, with playlist URIs rewritten to local names.
/// Replaces `AVAssetDownloadTask` because we need full control over custom
/// headers and because AVFoundation's offline player refuses to play the
/// resulting `.movpkg` in airplane mode.
///
/// Resume works for free: existing files are skipped on re-entry.
enum HLSDownloader {
    /// Dedicated session for offline downloads. A higher per-host connection
    /// cap lets a single title saturate the available bandwidth better than
    /// `URLSession.shared`, which is conservative for generic app traffic.
    private static let downloadSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.httpMaximumConnectionsPerHost = 16
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 300
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }()

    /// Bounded segment fan-out for a single title download.
    private static let maxConcurrentSegmentDownloads = 12

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

    /// Progress reported as a 0...1 fraction of the downloadable HLS resources
    /// completed. We weight sub-playlists by actual work item count
    /// (keys/maps + media files) instead of giving each playlist an equal
    /// slice, so mixed audio/subtitle/video masters stay much smoother.
    typealias ProgressHandler = @Sendable (Double) -> Void

    /// Run the download. Honours `Task` cancellation between resources.
    static func download(masterURL: URL,
                         headers: [String: String],
                         outputDirectory: URL,
                         session: URLSession = downloadSession,
                         progress: @escaping ProgressHandler) async throws {
        try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)

        // 1. Master playlist
        let masterText = try await fetchString(masterURL, headers: headers, session: session)
        var masterLines = masterText.components(separatedBy: "\n")

        // Pre-pass: identify every video variant (`#EXT-X-STREAM-INF` + URI
        // line) and keep only the one with the highest BANDWIDTH. Downloading
        // every quality would multiply data + time by 3-4x; AVPlayer only
        // needs one variant for offline. Other variant blocks are blanked.
        var variantBlocks: [(infIndex: Int, uriIndex: Int, bandwidth: Int)] = []
        do {
            var i = 0
            while i < masterLines.count {
                let line = masterLines[i].trimmingCharacters(in: .whitespaces)
                if line.hasPrefix("#EXT-X-STREAM-INF") {
                    let bw = HLSPlaylistParser.bandwidthAttribute(line) ?? 0
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
                if let uri = HLSPlaylistParser.extractURIAttribute(line) {
                    trackIndex += 1
                    let resolved = resolveURL(uri, relativeTo: masterURL)
                    let localName = "track-\(trackIndex).m3u8"
                    subPlaylists.append((resolved, localName))
                    masterLines[i] = HLSPlaylistParser.replaceURIAttribute(line, with: localName)
                }
            } else if line.hasPrefix("#EXT-X-I-FRAME-STREAM-INF"),
                      let uri = HLSPlaylistParser.extractURIAttribute(line) {
                trackIndex += 1
                let resolved = resolveURL(uri, relativeTo: masterURL)
                let localName = "track-\(trackIndex).m3u8"
                subPlaylists.append((resolved, localName))
                masterLines[i] = HLSPlaylistParser.replaceURIAttribute(line, with: localName)
            } else if !line.isEmpty && !line.hasPrefix("#") {
                // Variant URI line (kept video variant only; others are blank).
                trackIndex += 1
                let resolved = resolveURL(line, relativeTo: masterURL)
                let localName = "track-\(trackIndex).m3u8"
                subPlaylists.append((resolved, localName))
                masterLines[i] = localName
            }
        }

        if subPlaylists.isEmpty {
            // Master is already the media playlist (single-stream case).
            try await downloadVariant(text: masterText,
                                      sourceURL: masterURL,
                                      trackPrefix: "t1",
                                      headers: headers,
                                      outputDirectory: outputDirectory,
                                      session: session,
                                      progressBase: 0,
                                      progressSpan: 1,
                                      progress: progress,
                                      writeAs: "master.m3u8")
            progress(1)
            return
        }

        // 2. Fetch every kept sub-playlist first so we can weight progress by
        // actual work units instead of giving each playlist an equal slice.
        var fetched = Array<(sub: (absoluteURL: URL, localName: String), text: String, weight: Int)?>(repeating: nil, count: subPlaylists.count)
        try await withThrowingTaskGroup(of: (Int, (absoluteURL: URL, localName: String), String, Int).self) { group in
            for (index, sub) in subPlaylists.enumerated() {
                group.addTask {
                    try Task.checkCancellation()
                    let subText = try await fetchString(sub.absoluteURL, headers: headers, session: session)
                    let weight = max(1, HLSPlaylistParser.resourceCount(inVariantText: subText))
                    return (index, sub, subText, weight)
                }
            }

            for try await (index, sub, subText, weight) in group {
                fetched[index] = (sub: sub, text: subText, weight: weight)
            }
        }
        let resolvedPlaylists = fetched.compactMap { $0 }

        let totalWeight = max(1, resolvedPlaylists.reduce(0) { $0 + $1.weight })
        var completedWeight = 0
        for (idx, item) in resolvedPlaylists.enumerated() {
            try await downloadVariant(text: item.text,
                                      sourceURL: item.sub.absoluteURL,
                                      trackPrefix: "t\(idx + 1)",
                                      headers: headers,
                                      outputDirectory: outputDirectory,
                                      session: session,
                                      progressBase: Double(completedWeight) / Double(totalWeight),
                                      progressSpan: Double(item.weight) / Double(totalWeight),
                                      progress: progress,
                                      writeAs: item.sub.localName)
            completedWeight += item.weight
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
                if let uri = HLSPlaylistParser.extractURIAttribute(line) {
                    keyCounter += 1
                    let resolved = resolveURL(uri, relativeTo: sourceURL)
                    let ext = inferExtension(from: resolved, fallback: line.hasPrefix("#EXT-X-MAP") ? "mp4" : "key")
                    let localName = "\(trackPrefix)-k\(keyCounter).\(ext)"
                    keyDownloads.append((resolved, localName))
                    lines[i] = HLSPlaylistParser.replaceURIAttribute(line, with: localName)
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

        let allResourceNames = keyDownloads.map { $0.localName } + segmentDownloads.map { $0.localName }
        let totalResources = max(1, allResourceNames.count)
        var completedResources = allResourceNames.reduce(0) { partial, name in
            let target = outputDirectory.appendingPathComponent(name)
            return partial + (FileManager.default.fileExists(atPath: target.path) ? 1 : 0)
        }
        progress(progressBase + progressSpan * Double(completedResources) / Double(totalResources))

        // Keys are small but mandatory. Fetch them first and count them toward
        // progress so resume does not jump late from already-present segments.
        for (url, name) in keyDownloads {
            try Task.checkCancellation()
            let target = outputDirectory.appendingPathComponent(name)
            if FileManager.default.fileExists(atPath: target.path) { continue }
            let data = try await fetchData(url, headers: headers, session: session)
            try data.write(to: target, options: .atomic)
            completedResources += 1
            progress(progressBase + progressSpan * Double(completedResources) / Double(totalResources))
        }

        // Segments in parallel with bounded concurrency.
        let counter = SegmentCounter(initialValue: completedResources)
        try await withThrowingTaskGroup(of: Void.self) { group in
            var index = 0

            func enqueue() {
                guard index < segmentDownloads.count else { return }
                let (url, name) = segmentDownloads[index]
                index += 1
                group.addTask {
                    try Task.checkCancellation()
                    let target = outputDirectory.appendingPathComponent(name)
                    guard !FileManager.default.fileExists(atPath: target.path) else { return }
                    let data = try await fetchData(url, headers: headers, session: session)
                    try data.write(to: target, options: .atomic)
                    let done = await counter.increment()
                    progress(progressBase + progressSpan * Double(done) / Double(totalResources))
                }
            }

            for _ in 0..<min(maxConcurrentSegmentDownloads, segmentDownloads.count) { enqueue() }
            while try await group.next() != nil { enqueue() }
        }
    }

    /// Tiny actor-backed counter for thread-safe progress reporting across the
    /// parallel segment task group.
    private actor SegmentCounter {
        var done: Int

        init(initialValue: Int = 0) {
            self.done = initialValue
        }

        func increment() -> Int {
            done += 1
            return done
        }
    }

    // MARK: - Networking

    private static func fetchString(_ url: URL,
                                    headers: [String: String],
                                    session: URLSession) async throws -> String {
        let data = try await fetchData(url, headers: headers, session: session)
        guard let text = String(data: data, encoding: .utf8), !text.isEmpty else {
            throw DownloadError.emptyMaster
        }
        return text
    }

    private static func fetchData(_ url: URL,
                                  headers: [String: String],
                                  session: URLSession) async throws -> Data {
        var request = URLRequest(url: url)
        for (k, v) in headers {
            request.setValue(v, forHTTPHeaderField: k)
        }
        request.timeoutInterval = 30
        let (data, response) = try await session.data(for: request)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw DownloadError.fetchFailed(url, http.statusCode)
        }
        return data
    }

    private static func resolveURL(_ candidate: String, relativeTo base: URL) -> URL {
        if let absolute = URL(string: candidate), absolute.scheme != nil {
            return absolute
        }
        return URL(string: candidate, relativeTo: base)?.absoluteURL ?? base
    }

    /// Pick a reasonable file extension for a URL. Segments/keys may carry
    /// query strings or no extension at all.
    private static func inferExtension(from url: URL, fallback: String) -> String {
        let ext = url.pathExtension
        if !ext.isEmpty, ext.count <= 5, !ext.contains("?") {
            return ext
        }
        return fallback
    }

}
