import Foundation

struct LocalHLSFileResponse {
    let fileURL: URL
    let status: String
    let headers: [String: String]
    let rangeStart: Int64
    let length: Int64

    static func make(
        resolvedPath: String,
        documentsRoot: URL,
        requestLines: [String]
    ) -> Result<LocalHLSFileResponse, LocalHLSFileError> {
        let fileURL = documentsRoot.appendingPathComponent(resolvedPath).standardizedFileURL
        let rootPath = documentsRoot.standardizedFileURL.path
        guard fileURL.path.hasPrefix(rootPath + "/") || fileURL.path == rootPath else {
            return .failure(LocalHLSFileError(status: "403 Forbidden"))
        }

        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: fileURL.path, isDirectory: &isDir), !isDir.boolValue else {
            return .failure(LocalHLSFileError(status: "404 Not Found"))
        }

        guard let attrs = try? FileManager.default.attributesOfItem(atPath: fileURL.path),
              let totalSize = (attrs[.size] as? NSNumber)?.int64Value else {
            return .failure(LocalHLSFileError(status: "500 Internal Server Error"))
        }

        let range = parseRange(from: requestLines, totalSize: totalSize)
        if range.start < 0 || range.start > range.end || range.start >= totalSize {
            return .failure(LocalHLSFileError(
                status: "416 Range Not Satisfiable",
                extra: ["Content-Range": "bytes */\(totalSize)"]
            ))
        }

        let length = range.end - range.start + 1
        let partial = range.wasRequested && (range.start != 0 || range.end != totalSize - 1)
        var headers: [String: String] = [
            "Content-Type": mimeType(forExtension: fileURL.pathExtension),
            "Content-Length": "\(length)",
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
        ]
        if partial {
            headers["Content-Range"] = "bytes \(range.start)-\(range.end)/\(totalSize)"
        }

        return .success(LocalHLSFileResponse(
            fileURL: fileURL,
            status: partial ? "206 Partial Content" : "200 OK",
            headers: headers,
            rangeStart: range.start,
            length: length
        ))
    }

    private static func parseRange(
        from requestLines: [String],
        totalSize: Int64
    ) -> (start: Int64, end: Int64, wasRequested: Bool) {
        var rangeStart: Int64 = 0
        var rangeEnd: Int64 = totalSize - 1
        var isRange = false

        for line in requestLines.dropFirst() {
            if line.lowercased().hasPrefix("range:") {
                let spec = line.dropFirst("range:".count).trimmingCharacters(in: .whitespaces)
                guard spec.hasPrefix("bytes=") else { continue }
                let pair = spec.dropFirst("bytes=".count).split(
                    separator: "-",
                    maxSplits: 1,
                    omittingEmptySubsequences: false
                )
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

        return (rangeStart, rangeEnd, isRange)
    }

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
}

struct LocalHLSFileError: Error {
    let status: String
    var extra: [String: String] = [:]
}
