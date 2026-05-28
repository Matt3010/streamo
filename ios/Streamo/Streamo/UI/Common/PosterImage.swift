import SwiftUI
import UIKit
import CryptoKit

/// In-memory image cache so a poster already fetched shows instantly when you
/// navigate back to a page (no reload, no flicker, no re-failure).
enum ImageCache {
    static let shared: NSCache<NSURL, UIImage> = {
        let c = NSCache<NSURL, UIImage>()
        c.countLimit = 400
        return c
    }()

    /// Disk-backed mirror of the memory cache. Survives app restart and lets
    /// posters render offline as long as they were seen (or prefetched on
    /// download) at least once.
    static let disk = DiskImageCache(directoryName: "Streamo/Images")

    static func store(_ image: UIImage, data: Data?, for url: URL) {
        shared.setObject(image, forKey: url as NSURL)
        if let data { disk.store(data, for: url) }
    }
}

/// Persists fetched image bytes under Application Support (not Caches, which
/// iOS may purge under storage pressure — losing posters on a downloaded
/// series the user packed for an offline trip). Keyed by SHA-256 of the URL
/// so we don't have to sanitize paths, and stored as the original bytes so
/// UIImage can re-decode at any size. Files are excluded from iCloud backup
/// since they're derived from network sources.
struct DiskImageCache: Sendable {
    let root: URL

    init(directoryName: String) {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        self.root = support.appendingPathComponent(directoryName, isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        var resourceURL = root
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? resourceURL.setResourceValues(values)
    }

    func fileURL(for url: URL) -> URL {
        let digest = SHA256.hash(data: Data(url.absoluteString.utf8))
        let name = digest.map { String(format: "%02x", $0) }.joined()
        return root.appendingPathComponent(name)
    }

    func image(for url: URL) -> UIImage? {
        let file = fileURL(for: url)
        guard let data = try? Data(contentsOf: file) else { return nil }
        return UIImage(data: data)
    }

    func store(_ data: Data, for url: URL) {
        try? data.write(to: fileURL(for: url), options: .atomic)
    }

    /// Best-effort fetch into the disk cache — used to prime artwork for
    /// downloaded titles so they render in airplane mode.
    func prefetch(_ url: URL) async {
        if FileManager.default.fileExists(atPath: fileURL(for: url).path) { return }
        guard let (data, response) = try? await URLSession.shared.data(from: url) else { return }
        let ok = (response as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? true
        guard ok, UIImage(data: data) != nil else { return }
        store(data, for: url)
    }
}

/// Robust replacement for `AsyncImage`: serves from the in-memory cache, then
/// the disk cache, and on a transient network failure retries a few times with
/// backoff instead of leaving a permanent grey placeholder (the reason posters
/// sometimes went missing when opening pages).
struct PosterImage: View {
    let url: URL?
    var contentMode: ContentMode = .fill

    @State private var image: UIImage?

    var body: some View {
        ZStack {
            Color(.secondarySystemBackground)
            if let image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: contentMode)
            }
        }
        .task(id: url) { await load() }
    }

    private func load() async {
        image = nil
        guard let url else { return }
        if let cached = ImageCache.shared.object(forKey: url as NSURL) {
            image = cached
            return
        }
        if let cached = ImageCache.disk.image(for: url) {
            ImageCache.shared.setObject(cached, forKey: url as NSURL)
            image = cached
            return
        }
        for attempt in 0..<3 {
            if Task.isCancelled { return }
            if let (data, response) = try? await URLSession.shared.data(from: url) {
                let ok = (response as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? true
                if ok, let img = UIImage(data: data) {
                    ImageCache.store(img, data: data, for: url)
                    if !Task.isCancelled { image = img }
                    return
                }
            }
            try? await Task.sleep(for: .milliseconds(300 * (attempt + 1)))
        }
    }
}
