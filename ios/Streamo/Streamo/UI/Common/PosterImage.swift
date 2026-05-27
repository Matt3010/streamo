import SwiftUI
import UIKit

/// In-memory image cache so a poster already fetched shows instantly when you
/// navigate back to a page (no reload, no flicker, no re-failure).
enum ImageCache {
    static let shared: NSCache<NSURL, UIImage> = {
        let c = NSCache<NSURL, UIImage>()
        c.countLimit = 400
        return c
    }()
}

/// Robust replacement for `AsyncImage`: serves from the in-memory cache, and on
/// a transient network failure retries a few times with backoff instead of
/// leaving a permanent grey placeholder (the reason posters sometimes went
/// missing when opening pages).
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
        for attempt in 0..<3 {
            if Task.isCancelled { return }
            if let (data, response) = try? await URLSession.shared.data(from: url) {
                let ok = (response as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? true
                if ok, let img = UIImage(data: data) {
                    ImageCache.shared.setObject(img, forKey: url as NSURL)
                    if !Task.isCancelled { image = img }
                    return
                }
            }
            try? await Task.sleep(for: .milliseconds(300 * (attempt + 1)))
        }
    }
}
