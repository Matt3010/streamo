import SwiftUI
import UIKit

private enum LANSharePreparation {
    case ready(LANShareItem)
    case missingLocalNetwork
    case serverNotReady
}

private enum LANShareBuilder {
    static func prepare(entry: DownloadEntry,
                        key: String,
                        settings: AppSettings) -> LANSharePreparation {
        guard let ip = LANAddress.currentShareableIPv4() else {
            return .missingLocalNetwork
        }
        let port = LocalHLSServer.shared.waitForReady(timeout: 0.5)
        guard port != 0,
              let playerURL = LocalHLSServer.lanURL(host: ip, port: port,
                                                    token: settings.lanToken,
                                                    relativePath: "\(key)/play.html"),
              let manifestURL = LocalHLSServer.lanURL(host: ip, port: port,
                                                      token: settings.lanToken,
                                                      relativePath: "\(key)/master.m3u8") else {
            return .serverNotReady
        }
        let title = LANShareItem.titleFor(entry: entry)
        return .ready(LANShareItem(title: title,
                                   url: playerURL.absoluteString,
                                   manifestURL: manifestURL.absoluteString))
    }
}

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
    // Quick LAN-share toggle (toolbar). `lanIP`/`lanPort` are refreshed lazily
    // so the menu and toast can show the reachable address without an async hop.
    @State private var lanIP: String?
    @State private var lanPort: UInt16 = 0
    @State private var showLANQR = false
    @State private var showLANPasswordPrompt = false
    @State private var lanPasswordDraft = ""

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
        .toolbar { ToolbarItem(placement: .topBarTrailing) { lanToolbarToggle } }
        .task { if settings.lanShareEnabled { refreshLANInfo() } }
        .fullScreenCover(item: $pendingRequest) { PlayerScreen(request: $0) }
        .sheet(item: $pendingShare) { LANShareSheet(item: $0) }
        .sheet(isPresented: $showLANQR) {
            if let ip = lanIP, lanPort != 0 {
                LANIndexQRSheet(url: "http://\(ip):\(lanPort)/\(settings.lanToken)/")
            }
        }
        .alert("Password Condivisione LAN", isPresented: $showLANPasswordPrompt) {
            SecureField("Password", text: $lanPasswordDraft)
                .textInputAutocapitalization(.never)
            Button("Attiva") {
                let pw = lanPasswordDraft.trimmingCharacters(in: .whitespaces)
                guard !pw.isEmpty else { return }
                settings.lanPassword = pw
                enableLAN()
            }
            Button("Annulla", role: .cancel) {}
        } message: {
            Text("Imposta una password che verrà richiesta ai dispositivi sulla rete per accedere ai download.")
        }
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

    // MARK: - Quick LAN-share toggle

    /// Antenna button in the toolbar. A single tap flips LAN sharing on/off; a
    /// long-press opens a menu with the reachable address, QR, auto-off and an
    /// explicit "off". Saves the trip into Settings just to flip the switch.
    @ViewBuilder
    private var lanToolbarToggle: some View {
        Menu {
            if settings.lanShareEnabled {
                Section(lanStatusLine) {
                    if let ip = lanIP, lanPort != 0 {
                        Button {
                            UIPasteboard.general.string = "http://\(ip):\(lanPort)/\(settings.lanToken)/"
                            ToastCenter.shared.show("URL copiato")
                        } label: { Label("Copia URL (\(ip):\(lanPort))", systemImage: "doc.on.doc") }
                        Button { showLANQR = true } label: { Label("Mostra QR", systemImage: "qrcode") }
                    }
                    Button(role: .destructive) { disableLAN() } label: {
                        Label("Disattiva", systemImage: "antenna.radiowaves.left.and.right.slash")
                    }
                }
            } else {
                Button { toggleLAN() } label: {
                    Label("Attiva condivisione LAN", systemImage: "antenna.radiowaves.left.and.right")
                }
            }
        } label: {
            Image(systemName: settings.lanShareEnabled
                  ? "antenna.radiowaves.left.and.right"
                  : "antenna.radiowaves.left.and.right.slash")
            .foregroundStyle(settings.lanShareEnabled ? Theme.red : .secondary)
        } primaryAction: {
            toggleLAN()
        }
        .accessibilityLabel(settings.lanShareEnabled ? "Condivisione LAN attiva" : "Attiva condivisione LAN")
    }

    private func toggleLAN() {
        if settings.lanShareEnabled {
            disableLAN()
        } else if settings.lanPassword.isEmpty {
            lanPasswordDraft = ""
            showLANPasswordPrompt = true
        } else {
            enableLAN()
        }
    }

    private func enableLAN() {
        LANShareCoordinator.setEnabled(true)
        refreshLANInfo()
        if let ip = lanIP, lanPort != 0 {
            ToastCenter.shared.show("Condivisione LAN attiva — \(ip):\(lanPort)")
        } else {
            ToastCenter.shared.show("Condivisione LAN attiva")
        }
    }

    private func disableLAN() {
        LANShareCoordinator.setEnabled(false)
        ToastCenter.shared.show("Condivisione LAN disattivata")
    }

    private func refreshLANInfo() {
        lanIP = LANAddress.currentShareableIPv4()
        lanPort = LocalHLSServer.shared.waitForReady(timeout: 0.5)
    }

    /// Section header for the active-share menu — adds the auto-off time when set.
    private var lanStatusLine: String {
        if let deadline = settings.lanShareDeadline, settings.lanShareAutoOffMinutes > 0 {
            return "Attiva · si spegne \(deadline.formatted(date: .omitted, time: .shortened))"
        }
        return "Condivisione LAN attiva"
    }

    /// Returns the closure used by the row's "Condividi su LAN" menu item, or
    /// nil when sharing is disabled (so the row hides the menu entry).
    private func shareAction(for entry: DownloadEntry) -> (() -> Void)? {
        guard settings.lanShareEnabled, entry.state == .completed else { return nil }
        return {
            switch LANShareBuilder.prepare(entry: entry, key: downloads.key(for: entry), settings: settings) {
            case .ready(let item):
                pendingShare = item
            case .missingLocalNetwork:
                ToastCenter.shared.show("Collega il telefono a una rete locale o attiva l'Hotspot personale")
            case .serverNotReady:
                ToastCenter.shared.show("Server non pronto, riprova")
            }
        }
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
            switch LANShareBuilder.prepare(entry: entry, key: downloads.key(for: entry), settings: settings) {
            case .ready(let item):
                pendingShare = item
            case .missingLocalNetwork:
                ToastCenter.shared.show("Collega il telefono a una rete locale o attiva l'Hotspot personale")
            case .serverNotReady:
                ToastCenter.shared.show("Server non pronto, riprova")
            }
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
        guard displayState == .completed,
              let p = library.progress(entry.tmdbId, entry.mediaType, season: entry.season, episode: entry.episode),
              p.duration > 0 else { return 0 }
        return min(100, max(0, p.position / p.duration * 100))
    }

    private var displayState: DownloadState {
        downloads.displayState(for: entry)
    }

    private var isReconstructingProgress: Bool {
        downloads.isReconstructingProgress(for: entry)
    }

    var body: some View {
        HStack(spacing: 12) {
            if episodeLabel == nil { DownloadThumb(poster: entry.poster) }
            VStack(alignment: .leading, spacing: 4) {
                Text(episodeLabel ?? (entry.title ?? "Senza titolo"))
                    .font(.subheadline.weight(.semibold)).lineLimit(2)
                HStack(spacing: 6) {
                    Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    if let viaProxy = entry.viaProxy {
                        WarpBadge(viaProxy: viaProxy)
                    }
                }
                if displayState == .downloading || displayState == .paused {
                    if isReconstructingProgress {
                        ProgressView().tint(Theme.red)
                    } else {
                        ProgressView(value: downloads.progress(for: entry)).tint(Theme.red)
                    }
                } else if displayState == .completed, watchPct > 0 {
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
            if displayState == .completed {
                Button { onPlay() } label: { Label("Riproduci", systemImage: "play.fill") }
            }
            if let onShare {
                Button { onShare() } label: { Label("Condividi su LAN", systemImage: "wifi") }
            }
            Button(role: .destructive) { onDelete() } label: { Label("Elimina download", systemImage: "trash") }
        }
    }

    private var subtitle: String {
        switch displayState {
        case .queued:      return "In coda"
        case .downloading:
            return isReconstructingProgress ? "Ricostruendo progresso" : "\(downloads.progressPercent(for: entry))%"
        case .paused:      return "In pausa"
        case .completed:
            if watchPct >= 90 { return "Scaricato · visto" }
            if watchPct > 0 { return "Scaricato · visto al \(Format.percentValue(watchPct))%" }
            return "Scaricato — disponibile offline"
        case .failed:      return "Download non riuscito"
        }
    }

    @ViewBuilder
    private var control: some View {
        switch displayState {
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
                PosterImage(url: url, placeholderSystemImage: "film", contentMode: .fill)
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

/// QR + link for the LAN index page (`http://<ip>:<port>/<token>/`), shown from
/// the Downloads toolbar's quick-share menu. Lists every shared download; from
/// here a peer browses to a specific title.
struct LANIndexQRSheet: View {
    let url: String

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    QRCodeView(payload: url, size: 220)
                    Text(url)
                        .font(.system(.footnote, design: .monospaced))
                        .textSelection(.enabled)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                    Button {
                        UIPasteboard.general.string = url
                        ToastCenter.shared.show("URL copiato")
                    } label: {
                        Label("Copia URL", systemImage: "doc.on.doc")
                            .frame(maxWidth: 240)
                    }
                    .buttonStyle(BrandButtonStyle(kind: .primary, fullWidth: false))
                    Text("Inquadra il QR o apri il link su un dispositivo sulla stessa rete per vedere tutti i download condivisi.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }
                .padding(.vertical, 24)
                .frame(maxWidth: .infinity)
            }
            .navigationTitle("Condivisione LAN")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}
