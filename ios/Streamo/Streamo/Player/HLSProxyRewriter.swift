import Foundation

/// Swift port of the playlist-rewriting half of `ios/proxy/src/index.ts`.
///
/// The standalone Node proxy used to (1) rewrite the absolute vixcloud /
/// vix-content URLs inside an HLS playlist to proxy-relative paths and (2)
/// force a single video variant for a capped streaming quality. With the proxy
/// moved on-device (`LocalHLSServer` live-proxy routes + `WarpTunnel` egress)
/// the very same transformations now run here so every sub-playlist, segment
/// and key is pulled back through the on-device server — required so AirPlay
/// receivers (which send no headers) and the offline downloader keep flowing
/// through the WARP tunnel.
///
/// Pure functions, no network — unit-testable against a captured master m3u8.
enum HLSProxyRewriter {

    /// Mirror of JS `encodeURIComponent`: percent-encode everything except the
    /// unreserved set `A-Za-z0-9-_.!~*'()`. The auth token is base64url
    /// (`A-Za-z0-9-_`) so this is usually a no-op, but we match the Node
    /// behaviour byte-for-byte to keep signed URLs identical.
    private static let uriComponentAllowed: CharacterSet = {
        var set = CharacterSet.alphanumerics
        set.insert(charactersIn: "-_.!~*'()")
        return set
    }()

    private static func encodeURIComponent(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: uriComponentAllowed) ?? value
    }

    /// Rewrite absolute upstream URLs to proxy-relative paths and append the
    /// `?key=` (auth) / `&c=` (client tag) to every proxy-relative URL.
    ///
    /// Faithful port of `rewritePlaylist(body, token, client)`.
    static func rewritePlaylist(_ body: String, token: String, client: String = "-") -> String {
        // Step 1: absolute upstream URLs → proxy-relative paths. Order matters:
        // the vixcloud playlist/storage/jwplayer/favicon paths are stripped to
        // bare root-relative paths first, everything else vixcloud.co → /vixcloud.
        var rewritten = body
        rewritten = replace(rewritten,
            pattern: "https?://([a-z0-9-]+)\\.vix-content\\.net(/[^\\s\"']*)",
            template: "/cdn/$1$2")
        rewritten = replace(rewritten,
            pattern: "//([a-z0-9-]+)\\.vix-content\\.net(/[^\\s\"']*)",
            template: "/cdn/$1$2")
        rewritten = replace(rewritten,
            pattern: "https?://vixcloud\\.co(/(?:playlist|storage)/[^\\s\"']*|/jwplayer-[^\\s\"']*|/favicon\\.ico)",
            template: "$1")
        rewritten = replace(rewritten,
            pattern: "//vixcloud\\.co(/(?:playlist|storage)/[^\\s\"']*|/jwplayer-[^\\s\"']*|/favicon\\.ico)",
            template: "$1")
        rewritten = replace(rewritten,
            pattern: "https?://vixcloud\\.co(/[^\\s\"']*)",
            template: "/vixcloud$1")
        rewritten = replace(rewritten,
            pattern: "//vixcloud\\.co(/[^\\s\"']*)",
            template: "/vixcloud$1")

        // Step 2: append our auth/client params to EVERY proxy-relative URL
        // (sub-playlists, segments, and EXT-X-KEY/enc.key). AirPlay receivers
        // send no headers, so both must travel in each sub-resource URL. Skip
        // any that already carry the key.
        let key = encodeURIComponent(token)
        let suffix = client != "-"
            ? "key=\(key)&c=\(encodeURIComponent(client))"
            : "key=\(key)"
        return replaceMatches(rewritten, pattern: "/(?:cdn|vixcloud|storage|playlist)/[^\\s\"']*") { match in
            if match.range(of: "[?&]key=", options: .regularExpression) != nil { return match }
            return match.contains("?") ? "\(match)&\(suffix)" : "\(match)?\(suffix)"
        }
    }

    /// Keep only ONE video `#EXT-X-STREAM-INF` variant in a master playlist:
    /// the highest RESOLUTION height ≤ `maxHeight`, else the lowest (all
    /// taller), else (no RESOLUTION info) the highest BANDWIDTH. Non-master
    /// playlists pass through unchanged.
    ///
    /// Faithful port of `filterMasterToHeight(body, maxHeight)`.
    static func filterMasterToHeight(_ body: String, maxHeight: Int) -> String {
        guard maxHeight > 0 else { return body }
        let lines = body.components(separatedBy: "\n")

        struct Block { let infIndex: Int; let uriIndex: Int; let bandwidth: Int; let height: Int }
        var blocks: [Block] = []
        for i in lines.indices {
            guard lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("#EXT-X-STREAM-INF") else { continue }
            let inf = lines[i]
            let bw = HLSPlaylistParser.bandwidthAttribute(inf) ?? 0
            let height = HLSPlaylistParser.resolutionHeightAttribute(inf) ?? 0
            // URI is the next non-empty, non-comment line.
            var k = i + 1
            while k < lines.count {
                let t = lines[k].trimmingCharacters(in: .whitespaces)
                if t.isEmpty || t.hasPrefix("#") { k += 1 } else { break }
            }
            if k < lines.count { blocks.append(Block(infIndex: i, uriIndex: k, bandwidth: bw, height: height)) }
        }
        guard blocks.count > 1 else { return body }

        let withHeight = blocks.filter { $0.height > 0 }
        let chosen: Block?
        if !withHeight.isEmpty {
            let eligible = withHeight.filter { $0.height <= maxHeight }
            if !eligible.isEmpty {
                chosen = eligible.max(by: { $0.height < $1.height })       // highest ≤ max
            } else {
                chosen = withHeight.min(by: { $0.height < $1.height })     // lowest (all taller)
            }
        } else {
            chosen = blocks.max(by: { $0.bandwidth < $1.bandwidth })       // highest bandwidth
        }
        guard let keep = chosen else { return body }

        var drop = Set<Int>()
        for b in blocks where b.uriIndex != keep.uriIndex {
            drop.insert(b.infIndex)
            drop.insert(b.uriIndex)
        }
        return lines.enumerated().filter { !drop.contains($0.offset) }.map(\.element).joined(separator: "\n")
    }

    // MARK: - Regex helpers

    /// Template-based replace (`$1`, `$2` …), case-insensitive, like JS
    /// `String.replace(regex, '$1$2')`.
    private static func replace(_ text: String, pattern: String, template: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return text }
        let range = NSRange(text.startIndex..., in: text)
        return regex.stringByReplacingMatches(in: text, range: range, withTemplate: template)
    }

    /// Closure-based replace, like JS `String.replace(regex, fn)`. Matches are
    /// processed back-to-front so earlier ranges stay valid as we splice.
    private static func replaceMatches(_ text: String, pattern: String, _ transform: (String) -> String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return text }
        let full = NSRange(text.startIndex..., in: text)
        let matches = regex.matches(in: text, range: full)
        var result = text
        for match in matches.reversed() {
            guard let r = Range(match.range, in: result) else { continue }
            result.replaceSubrange(r, with: transform(String(result[r])))
        }
        return result
    }
}
