import Foundation

enum DownloadStorageInspector {
    static func folderSize(_ dir: URL) -> Int64 {
        let fm = FileManager.default
        guard let files = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.fileSizeKey]) else {
            return 0
        }
        return files.reduce(Int64(0)) { sum, url in
            sum + Int64((try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0)
        }
    }

    static func resumedProgress(in dir: URL, fallback: Double) -> Double {
        guard FileManager.default.fileExists(atPath: dir.path) else { return fallback }

        let fm = FileManager.default
        let directoryContents = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)
        let playlists = directoryContents?.filter { $0.pathExtension.lowercased() == "m3u8" } ?? []
        guard !playlists.isEmpty else { return fallback }

        let master = dir.appendingPathComponent("master.m3u8")
        let referencedTrackNames = (try? String(contentsOf: master, encoding: .utf8))
            .map { HLSPlaylistParser.childPlaylistNames(in: $0) } ?? []
        let referencedTracks = referencedTrackNames.map { dir.appendingPathComponent($0) }
            .filter { fm.fileExists(atPath: $0.path) }
        let trackPlaylists = playlists.filter { $0.lastPathComponent != "master.m3u8" }
        let sources = !referencedTracks.isEmpty
            ? referencedTracks
            : (trackPlaylists.isEmpty
                ? playlists.filter { $0.lastPathComponent == "master.m3u8" }
                : trackPlaylists)
        guard !sources.isEmpty else { return fallback }

        var totalResources = 0
        var completedResources = 0
        for playlist in sources {
            guard let text = try? String(contentsOf: playlist, encoding: .utf8) else {
                continue
            }
            let resources = HLSPlaylistParser.resourceNames(in: text)
            totalResources += resources.count
            completedResources += resources.reduce(0) { partial, name in
                partial + (fm.fileExists(atPath: dir.appendingPathComponent(name).path) ? 1 : 0)
            }
        }
        guard totalResources > 0 else { return fallback }
        let fraction = Double(completedResources) / Double(totalResources)
        return max(fallback, min(1, fraction))
    }
}
