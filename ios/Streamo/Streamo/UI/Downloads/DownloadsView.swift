import SwiftUI
import UIKit

/// Offline downloads page. Movies are flat rows; TV series are grouped into one
/// row that opens a per-season episode list. Completed items also show the
/// viewing progress. Reached from the Home toolbar.
struct DownloadsView: View {
    @Environment(Library.self) private var library
    @Bindable private var settings = AppSettings.shared
    @State private var downloads = DownloadManager.shared
    @State private var pendingRequest: PlaybackRequest?
    @State private var pendingDelete: DownloadEntry?
    @State private var pendingShare: LANShareItem?

    /// One row in the list: a movie, or a whole TV series (its episodes).
    private enum Item: Identifiable {
        case movie(DownloadEntry)
        case series(tmdbId: Int, title: String, poster: String?, episodes: [DownloadEntry])
        var id: String {
            switch self {
            case .movie(let e): return "m-\(e.tmdbId)"
            case .series(let id, _, _, _): return "s-\(id)"
            }
        }
    }

    /// Movies and series interleaved by first appearance (addedAt order).
    private func grouped(_ entries: [DownloadEntry]) -> [Item] {
        var seenSeries = Set<Int>()
        var out: [Item] = []
        for e in entries {
            if e.mediaType == .movie {
                out.append(.movie(e))
            } else if seenSeries.insert(e.tmdbId).inserted {
                let eps = entries.filter { $0.mediaType == .tv && $0.tmdbId == e.tmdbId }
                out.append(.series(tmdbId: e.tmdbId, title: e.title ?? "Serie", poster: e.poster, episodes: eps))
            }
        }
        return out
    }

    var body: some View {
        let _ = library.version
        let items = library.downloads()

        Group {
            if items.isEmpty {
                ContentUnavailableView("Nessun download", systemImage: "arrow.down.circle",
                    description: Text("Scarica film ed episodi dalla loro pagina per guardarli offline."))
            } else {
                List {
                    ForEach(grouped(items)) { item in
                        switch item {
                        case .movie(let e):
                            DownloadRow(entry: e, downloads: downloads, library: library,
                                        onPlay: { pendingRequest = playRequest(e) },
                                        onDelete: { pendingDelete = e },
                                        onShare: shareAction(for: e))
                        case .series(let id, let title, let poster, let eps):
                            NavigationLink {
                                SeriesDownloadsView(tmdbId: id, title: title)
                            } label: {
                                seriesRow(title: title, poster: poster, episodes: eps)
                            }
                            .contextMenu {
                                Button(role: .destructive) {
                                    for e in eps { downloads.delete(e) }
                                } label: { Label("Elimina tutti i download", systemImage: "trash") }
                            }
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("Download")
        .navigationBarTitleDisplayMode(.inline)
        .fullScreenCover(item: $pendingRequest) { PlayerScreen(request: $0) }
        .sheet(item: $pendingShare) { LANShareSheet(item: $0) }
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

    /// Returns the closure used by the row's "Condividi su LAN" menu item, or
    /// nil when sharing is disabled (so the row hides the menu entry).
    private func shareAction(for entry: DownloadEntry) -> (() -> Void)? {
        guard settings.lanShareEnabled, entry.state == .completed else { return nil }
        return {
            if let item = makeShareItem(for: entry) {
                pendingShare = item
            } else {
                ToastCenter.shared.show("Collega il telefono a una rete locale o attiva l'Hotspot personale")
            }
        }
    }

    private func makeShareItem(for entry: DownloadEntry) -> LANShareItem? {
        let key = downloads.key(for: entry)
        guard let ip = LANAddress.currentShareableIPv4() else { return nil }
        let port = LocalHLSServer.shared.waitForReady(timeout: 0.5)
        guard port != 0 else { return nil }
        guard let playerURL = LocalHLSServer.lanURL(host: ip, port: port,
                                                    token: settings.lanToken,
                                                    relativePath: "\(key)/play.html"),
              let manifestURL = LocalHLSServer.lanURL(host: ip, port: port,
                                                     token: settings.lanToken,
                                                     relativePath: "\(key)/master.m3u8") else { return nil }
        let title = LANShareItem.titleFor(entry: entry)
        return LANShareItem(title: title,
                            url: playerURL.absoluteString,
                            manifestURL: manifestURL.absoluteString)
    }

    private func seriesRow(title: String, poster: String?, episodes: [DownloadEntry]) -> some View {
        let done = episodes.filter { $0.state == .completed }.count
        let total = episodes.count
        let detail = done == total ? "\(total) episodi scaricati"
                                   : "\(done)/\(total) episodi scaricati"
        return HStack(spacing: 12) {
            DownloadThumb(poster: poster)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.subheadline.weight(.semibold)).lineLimit(2)
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
        }
        .padding(.vertical, 4)
    }

    private func playRequest(_ e: DownloadEntry) -> PlaybackRequest? {
        guard let url = downloads.offlineURL(for: e) else { return nil }
        let watched = library.progress(e.tmdbId, e.mediaType, season: e.season, episode: e.episode)
        return PlaybackRequest(tmdbId: e.tmdbId, mediaType: e.mediaType, title: e.title ?? "—",
                               releaseDate: e.releaseDate, poster: e.poster, backdrop: nil,
                               season: e.season, episode: e.episode,
                               startAt: watched?.position ?? 0, offlineURL: url)
    }
}

/// Per-series downloads, episodes grouped by season.
struct SeriesDownloadsView: View {
    let tmdbId: Int
    let title: String
    @Environment(\.dismiss) private var dismiss
    @Environment(Library.self) private var library
    @Bindable private var settings = AppSettings.shared
    @State private var downloads = DownloadManager.shared
    @State private var pendingRequest: PlaybackRequest?
    @State private var pendingDelete: DownloadEntry?
    @State private var pendingShare: LANShareItem?

    var body: some View {
        let _ = library.version
        let episodes = library.downloads().filter { $0.mediaType == .tv && $0.tmdbId == tmdbId }
        let seasons = Dictionary(grouping: episodes, by: { $0.season }).sorted { $0.key < $1.key }

        List {
            ForEach(seasons, id: \.key) { season, eps in
                Section("Stagione \(season)") {
                    ForEach(eps.sorted { $0.episode < $1.episode }, id: \.persistentModelID) { e in
                        DownloadRow(entry: e, downloads: downloads, library: library,
                                    episodeLabel: "Episodio \(e.episode)",
                                    onPlay: { pendingRequest = playRequest(e) },
                                    onDelete: { deleteOrConfirm(e) },
                                    onShare: shareAction(for: e))
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .fullScreenCover(item: $pendingRequest) { PlayerScreen(request: $0) }
        .sheet(item: $pendingShare) { LANShareSheet(item: $0) }
        .confirmationDialog("Eliminare questo episodio?",
                            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
                            titleVisibility: .visible) {
            Button("Elimina", role: .destructive) {
                if let e = pendingDelete { deleteEpisode(e) }
                pendingDelete = nil
            }
            Button("Annulla", role: .cancel) { pendingDelete = nil }
        }
    }

    private func shareAction(for entry: DownloadEntry) -> (() -> Void)? {
        guard settings.lanShareEnabled, entry.state == .completed else { return nil }
        return {
            let key = downloads.key(for: entry)
            guard let ip = LANAddress.currentShareableIPv4() else {
                ToastCenter.shared.show("Collega il telefono a una rete locale o attiva l'Hotspot personale")
                return
            }
            let port = LocalHLSServer.shared.waitForReady(timeout: 0.5)
            guard port != 0,
                  let playerURL = LocalHLSServer.lanURL(host: ip, port: port,
                                                        token: settings.lanToken,
                                                        relativePath: "\(key)/play.html"),
                  let manifestURL = LocalHLSServer.lanURL(host: ip, port: port,
                                                         token: settings.lanToken,
                                                         relativePath: "\(key)/master.m3u8") else {
                ToastCenter.shared.show("Server non pronto, riprova")
                return
            }
            pendingShare = LANShareItem(title: LANShareItem.titleFor(entry: entry),
                                        url: playerURL.absoluteString,
                                        manifestURL: manifestURL.absoluteString)
        }
    }

    private func deleteOrConfirm(_ entry: DownloadEntry) {
        pendingDelete = entry
    }

    private func deleteEpisode(_ entry: DownloadEntry) {
        downloads.delete(entry)
        let remaining = library.downloads().contains {
            $0.mediaType == .tv && $0.tmdbId == tmdbId && $0.persistentModelID != entry.persistentModelID
        }
        if !remaining {
            dismiss()
        }
    }

    private func playRequest(_ e: DownloadEntry) -> PlaybackRequest? {
        guard let url = downloads.offlineURL(for: e) else { return nil }
        let watched = library.progress(e.tmdbId, e.mediaType, season: e.season, episode: e.episode)
        return PlaybackRequest(tmdbId: e.tmdbId, mediaType: e.mediaType, title: e.title ?? "—",
                               releaseDate: e.releaseDate, poster: e.poster, backdrop: nil,
                               season: e.season, episode: e.episode,
                               startAt: watched?.position ?? 0, offlineURL: url)
    }
}

/// A single download row (movie or episode): thumb, title/subtitle, download
/// progress while transferring or watch progress when completed, and a control.
private struct DownloadRow: View {
    let entry: DownloadEntry
    let downloads: DownloadManager
    let library: Library
    var episodeLabel: String? = nil
    var onPlay: () -> Void
    var onDelete: () -> Void
    var onShare: (() -> Void)? = nil

    private var watchPct: Double {
        guard entry.state == .completed,
              let p = library.progress(entry.tmdbId, entry.mediaType, season: entry.season, episode: entry.episode),
              p.duration > 0 else { return 0 }
        return min(100, max(0, p.position / p.duration * 100))
    }

    var body: some View {
        HStack(spacing: 12) {
            if episodeLabel == nil { DownloadThumb(poster: entry.poster) }
            VStack(alignment: .leading, spacing: 4) {
                Text(episodeLabel ?? (entry.title ?? "Senza titolo"))
                    .font(.subheadline.weight(.semibold)).lineLimit(2)
                Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                if entry.state == .downloading || entry.state == .paused {
                    ProgressView(value: downloads.progress(for: entry)).tint(Theme.red)
                } else if entry.state == .completed, watchPct > 0 {
                    ProgressBar(percent: watchPct)
                }
            }
            Spacer(minLength: 8)
            control
        }
        .padding(.vertical, 4)
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) { onDelete() } label: { Label("Elimina", systemImage: "trash") }
        }
        .contextMenu {
            if entry.state == .completed {
                Button { onPlay() } label: { Label("Riproduci", systemImage: "play.fill") }
            }
            if let onShare {
                Button { onShare() } label: { Label("Condividi su LAN", systemImage: "wifi") }
            }
            Button(role: .destructive) { onDelete() } label: { Label("Elimina download", systemImage: "trash") }
        }
    }

    private var subtitle: String {
        switch entry.state {
        case .queued:      return "In coda"
        case .downloading: return "\(Int(downloads.progress(for: entry) * 100))%"
        case .paused:      return "In pausa"
        case .completed:
            if watchPct >= 90 { return "Scaricato · visto" }
            if watchPct > 0 { return "Scaricato · visto al \(Int(watchPct))%" }
            return "Scaricato — disponibile offline"
        case .failed:      return "Download non riuscito"
        }
    }

    @ViewBuilder
    private var control: some View {
        switch entry.state {
        case .completed:
            Button(action: onPlay) {
                Image(systemName: "play.circle.fill")
                    .font(.title2)
                    .foregroundStyle(Theme.red)
                    .frame(width: 32, height: 32)
            }
                .buttonStyle(.plain)
        case .downloading:
            Button { downloads.pause(entry) } label: {
                Image(systemName: "pause.circle")
                    .font(.title2)
                    .foregroundStyle(.secondary)
                    .frame(width: 32, height: 32)
            }
                .buttonStyle(.plain)
        case .paused:
            Button { downloads.resume(entry) } label: {
                Image(systemName: "arrow.down.circle")
                    .font(.title2)
                    .foregroundStyle(Theme.red)
                    .frame(width: 32, height: 32)
            }
                .buttonStyle(.plain)
        case .failed:
            Button { retry() } label: {
                Image(systemName: "arrow.clockwise.circle")
                    .font(.title2)
                    .foregroundStyle(Theme.red)
                    .frame(width: 32, height: 32)
            }
                .buttonStyle(.plain)
        case .queued:
            Image(systemName: "clock")
                .foregroundStyle(.secondary)
                .frame(width: 32, height: 32)
        }
    }

    private func retry() {
        library.setDownloadState(entry, .queued, progress: 0)
        downloads.enqueue(tmdbId: entry.tmdbId, type: entry.mediaType, season: entry.season,
                          episode: entry.episode, title: entry.title, poster: entry.poster,
                          backdrop: entry.backdrop, releaseDate: entry.releaseDate,
                          episodeTitle: entry.episodeTitle, episodeOverview: entry.episodeOverview,
                          episodeStill: entry.episodeStill, episodeRuntime: entry.episodeRuntime)
    }
}

/// Small 2:3 poster thumbnail used by the download rows.
private struct DownloadThumb: View {
    let poster: String?
    var body: some View {
        Group {
            if let url = TmdbImage.url(poster, .w92) {
                PosterImage(url: url, contentMode: .fill)
            } else {
                ZStack { Color(.secondarySystemBackground); Image(systemName: "film").foregroundStyle(.secondary) }
            }
        }
        .frame(width: 46, height: 69)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}

/// Payload for the LAN-share sheet — Identifiable so it can drive a
/// `.sheet(item:)` binding. The primary `url` points at the in-browser player
/// page; `manifestURL` is the raw `.m3u8` for VLC users.
struct LANShareItem: Identifiable {
    let title: String
    let url: String
    let manifestURL: String
    var id: String { url }

    static func titleFor(entry: DownloadEntry) -> String {
        let base = entry.title ?? "Senza titolo"
        guard entry.mediaType == .tv else { return base }
        return "\(base) — S\(entry.season) E\(entry.episode)"
    }
}

/// Sheet shown when the user picks "Condividi su LAN" on a specific download:
/// title, scannable QR pointing at the browser player, plus the raw m3u8 link
/// for VLC users underneath. Wrapped in a NavigationStack so a long title
/// gets the inline-nav-bar truncation rather than clipping on small screens;
/// dismiss is via the drag indicator / swipe-down.
struct LANShareSheet: View {
    let item: LANShareItem

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    QRCodeView(payload: item.url, size: 220)

                    VStack(spacing: 6) {
                        Text("Link browser")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .textCase(.uppercase)
                            .tracking(0.5)
                        Text(item.url)
                            .font(.system(.footnote, design: .monospaced))
                            .textSelection(.enabled)
                            .multilineTextAlignment(.center)
                            .lineLimit(nil)
                            .padding(.horizontal)
                    }

                    Button {
                        UIPasteboard.general.string = item.url
                        ToastCenter.shared.show("Link copiato")
                    } label: {
                        Label("Copia link", systemImage: "doc.on.doc")
                            .frame(maxWidth: 240)
                    }
                    .buttonStyle(BrandButtonStyle(kind: .primary, fullWidth: false))

                    Divider().padding(.horizontal, 40)

                    VStack(spacing: 8) {
                        Text("Preferisci VLC?")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Text(item.manifestURL)
                            .font(.system(.caption2, design: .monospaced))
                            .textSelection(.enabled)
                            .multilineTextAlignment(.center)
                            .lineLimit(nil)
                            .padding(.horizontal)
                        Button("Copia link VLC") {
                            UIPasteboard.general.string = item.manifestURL
                            ToastCenter.shared.show("Link VLC copiato")
                        }
                        .font(.footnote)
                    }

                    Text("Apri il link browser su Chrome / Edge / Safari sullo stesso Wi-Fi. Il VLC accetta il link .m3u8 (Media → Apri flusso di rete).")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }
                .padding(.vertical, 24)
                .frame(maxWidth: .infinity)
            }
            .navigationTitle(item.title)
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}
