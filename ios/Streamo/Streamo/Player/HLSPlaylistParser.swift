import Foundation

/// Shared HLS line parser used both while downloading and when reconstructing
/// progress from on-disk playlists after a resume/relaunch.
enum HLSPlaylistParser {
    /// Extract the `URI="..."` attribute value from an HLS tag line.
    static func extractURIAttribute(_ line: String) -> String? {
        guard let range = line.range(of: "URI=\"") else { return nil }
        let afterQuote = line[range.upperBound...]
        guard let end = afterQuote.firstIndex(of: "\"") else { return nil }
        return String(afterQuote[..<end])
    }

    /// Replace the existing `URI="..."` value with `newValue` (re-quoted).
    static func replaceURIAttribute(_ line: String, with newValue: String) -> String {
        guard let openRange = line.range(of: "URI=\"") else { return line }
        let afterQuote = line[openRange.upperBound...]
        guard let endRelative = afterQuote.firstIndex(of: "\"") else { return line }
        let endIndex = endRelative
        var rewritten = line
        rewritten.replaceSubrange(openRange.upperBound..<endIndex, with: newValue)
        return rewritten
    }

    /// Extract the integer `BANDWIDTH=N` attribute from `#EXT-X-STREAM-INF`.
    static func bandwidthAttribute(_ line: String) -> Int? {
        guard let range = line.range(of: "BANDWIDTH=") else { return nil }
        let after = line[range.upperBound...]
        let digits = after.prefix(while: { $0.isNumber })
        return Int(digits)
    }

    /// Local child playlist names a rewritten master refers to.
    static func childPlaylistNames(in text: String) -> [String] {
        var names: [String] = []
        for raw in text.components(separatedBy: .newlines) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("#EXT-X-MEDIA") || line.hasPrefix("#EXT-X-I-FRAME-STREAM-INF") {
                if let uri = extractURIAttribute(line), uri.hasSuffix(".m3u8") {
                    names.append(uri)
                }
            } else if !line.isEmpty, !line.hasPrefix("#"), line.hasSuffix(".m3u8") {
                names.append(line)
            }
        }
        return names
    }

    /// Resource names a rewritten local playlist refers to: keys/maps plus
    /// media files, excluding nested playlists.
    static func resourceNames(in text: String) -> [String] {
        var resources: [String] = []
        for raw in text.components(separatedBy: .newlines) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("#EXT-X-KEY") || line.hasPrefix("#EXT-X-SESSION-KEY") || line.hasPrefix("#EXT-X-MAP") {
                if let uri = extractURIAttribute(line) {
                    resources.append(uri)
                }
            } else if !line.isEmpty, !line.hasPrefix("#"), !line.hasSuffix(".m3u8") {
                resources.append(line)
            }
        }
        return resources
    }

    /// Count the resources this variant will actually download so callers can
    /// give it a fair share of the overall progress bar.
    static func resourceCount(inVariantText text: String) -> Int {
        resourceNames(in: text).count
    }
}
