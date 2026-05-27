import SwiftUI

/// Offline downloads page: serial queue status, per-item progress + controls,
/// and offline playback. Reached from the Home toolbar.
struct DownloadsView: View {
    @Environment(Library.self) private var library
    @State private var downloads = DownloadManager.shared
    @State private var pendingRequest: PlaybackRequest?
    @State private var pendingDelete: DownloadEntry?

    var body: some View {
        let _ = library.version
        let items = library.downloads()

        Group {
            if items.isEmpty {
                ContentUnavailableView("Nessun download", systemImage: "arrow.down.circle",
                    description: Text("Scarica film ed episodi dalla loro pagina per guardarli offline."))
            } else {
                List {
                    ForEach(items, id: \.persistentModelID) { row($0) }
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("Download")
        .navigationBarTitleDisplayMode(.inline)
        .fullScreenCover(item: $pendingRequest) { PlayerScreen(request: $0) }
        .confirmationDialog("Eliminare questo download?",
                            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
                            titleVisibility: .visible) {
            Button("Elimina", role: .destructive) {
                if let e = pendingDelete { downloads.delete(e) }
                pendingDelete = nil
            }
            Button("Annulla", role: .cancel) { pendingDelete = nil }
        }
    }

    @ViewBuilder
    private func row(_ entry: DownloadEntry) -> some View {
        HStack(spacing: 12) {
            thumb(entry.poster)
            VStack(alignment: .leading, spacing: 4) {
                Text(title(entry)).font(.subheadline.weight(.semibold)).lineLimit(2)
                Text(subtitle(entry)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                if entry.state == .downloading || entry.state == .paused {
                    ProgressView(value: downloads.progress(for: entry)).tint(Theme.red)
                }
            }
            Spacer(minLength: 8)
            control(entry)
        }
        .padding(.vertical, 4)
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) { pendingDelete = entry } label: { Label("Elimina", systemImage: "trash") }
        }
    }

    @ViewBuilder
    private func control(_ entry: DownloadEntry) -> some View {
        switch entry.state {
        case .completed:
            Button { pendingRequest = playRequest(entry) } label: {
                Image(systemName: "play.circle.fill").font(.title2).foregroundStyle(Theme.red)
            }
            .buttonStyle(.plain)
        case .downloading:
            Button { downloads.pause(entry) } label: {
                Image(systemName: "pause.circle").font(.title2).foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        case .paused:
            Button { downloads.resume(entry) } label: {
                Image(systemName: "arrow.down.circle").font(.title2).foregroundStyle(Theme.red)
            }
            .buttonStyle(.plain)
        case .failed:
            Button { retry(entry) } label: {
                Image(systemName: "arrow.clockwise.circle").font(.title2).foregroundStyle(Theme.red)
            }
            .buttonStyle(.plain)
        case .queued:
            Image(systemName: "clock").foregroundStyle(.secondary)
        }
    }

    /// Re-queue a failed download.
    private func retry(_ entry: DownloadEntry) {
        guard entry.state == .failed else { return }
        library.setDownloadState(entry, .queued, progress: 0)
        downloads.enqueue(tmdbId: entry.tmdbId, type: entry.mediaType, season: entry.season,
                          episode: entry.episode, title: entry.title, poster: entry.poster,
                          releaseDate: entry.releaseDate)
    }

    private func playRequest(_ e: DownloadEntry) -> PlaybackRequest? {
        guard let url = downloads.offlineURL(for: e) else { return nil }
        return PlaybackRequest(tmdbId: e.tmdbId, mediaType: e.mediaType, title: e.title ?? "—",
                               releaseDate: e.releaseDate, poster: e.poster, backdrop: nil,
                               season: e.season, episode: e.episode, startAt: 0, offlineURL: url)
    }

    private func title(_ e: DownloadEntry) -> String {
        let base = e.title ?? "Senza titolo"
        return e.mediaType == .tv && e.season > 0 ? "\(base) · S\(e.season) E\(e.episode)" : base
    }

    private func subtitle(_ e: DownloadEntry) -> String {
        switch e.state {
        case .queued:      return "In coda"
        case .downloading: return "\(Int(downloads.progress(for: e) * 100))%"
        case .paused:      return "In pausa"
        case .completed:   return "Scaricato — disponibile offline"
        case .failed:      return e.errorMessage ?? "Download non riuscito"
        }
    }

    @ViewBuilder
    private func thumb(_ poster: String?) -> some View {
        Group {
            if let url = TmdbImage.url(poster, .w92) {
                AsyncImage(url: url) { $0.resizable().aspectRatio(contentMode: .fill) }
                    placeholder: { Color(.secondarySystemBackground) }
            } else {
                ZStack { Color(.secondarySystemBackground); Image(systemName: "film").foregroundStyle(.secondary) }
            }
        }
        .frame(width: 46, height: 69)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}
