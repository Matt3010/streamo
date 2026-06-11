import SwiftUI
import WidgetKit

struct RootTabView: View {
    @Environment(Library.self) private var library
    @Environment(AppNavigation.self) private var nav
    @Environment(\.scenePhase) private var scenePhase
    @State private var network = NetworkMonitor.shared

    var body: some View {
        Group {
            if network.isOnline {
                onlineTabs
            } else {
                offlineRoot
            }
        }
        .sheet(item: Binding(get: { nav.presentedSheet }, set: { nav.presentedSheet = $0 })) { route in
            NavigationStack {
                Group {
                    switch route {
                    case .history:
                        HistoryView().navigationDestination(for: MediaRef.self) { DetailView(ref: $0) }
                    case .settings:
                        SettingsView()
                    case .downloads:
                        DownloadsView()
                    }
                }
                .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Chiudi") { nav.presentedSheet = nil } } }
            }
            // The root's `.tint` is applied below this `.sheet`, so it doesn't
            // reliably reach the sheet's own presentation context — re-apply it
            // here so text buttons inside Settings / History / Downloads show
            // the accent colour (and a clear tinted pressed state).
            .tint(Theme.red)
            // Sheets present above the root window, so the root's toast overlay
            // is hidden behind them — give the sheet its own overlay so toasts
            // from Settings / History / Downloads are visible.
            .toastOverlay()
        }
        .tint(Theme.red)   // reactive: re-tints native controls when the accent changes
        .toastOverlay()
        .task {
            DownloadManager.shared.configure(library: library)
            let s = AppSettings.shared
            LocalHLSServer.shared.setLANConfig(enabled: s.lanShareEnabled, token: s.lanToken, password: s.lanPassword)
            if s.lanShareEnabled { BackgroundKeepAlive.shared.start() }
            LANAutoShutoff.shared.reschedule()
            // Honour a LAN toggle made from the Control Center control that
            // launched (or returned to) the app, and seed the control's state.
            LANShareCoordinator.applyPendingControlRequest()
            // Warm the WARP tunnel at launch so the first playback doesn't race
            // the WireGuard handshake (which can take seconds) and fail.
            if AppSettings.shared.providerProxyActive {
                Task { try? await WarpTunnel.shared.start() }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                WidgetCenter.shared.reloadAllTimelines()
                // The tunnel may not survive suspension — flag it so the next
                // start() re-probes and restarts instead of reusing a dead session.
                Task { await WarpTunnel.shared.invalidate() }
            case .active:
                LANShareCoordinator.applyPendingControlRequest()
                // Re-validate (and restart if dead) before the user taps play.
                if AppSettings.shared.providerProxyActive {
                    Task { try? await WarpTunnel.shared.start() }
                }
            default:
                break
            }
        }
        .onOpenURL { url in handleDeepLink(url) }
    }

    private var onlineTabs: some View {
        TabView(selection: Binding(get: { nav.selectedTab }, set: { newTab in
            // Tapping the Search tab (including a re-tap when already there)
            // asks SearchView to re-open the keyboard.
            if newTab == .search { nav.searchFocusRequest += 1 }
            nav.selectedTab = newTab
        })) {
            NavigationStack(path: Binding(get: { nav.homePath }, set: { nav.homePath = $0 })) {
                HomeView()
                    .navigationDestination(for: MediaRef.self) { DetailView(ref: $0) }
                    .toolbarActions()
                    .background { AmbientBackground() }
            }
            .tabItem { Label("Home", systemImage: "house.fill") }
            .tag(AppNavigation.Tab.home)

            NavigationStack {
                SearchView()
                    .navigationDestination(for: MediaRef.self) { DetailView(ref: $0) }
                    .toolbarActions()
                    .background { AmbientBackground() }
            }
            .tabItem { Label("Cerca", systemImage: "magnifyingglass") }
            .tag(AppNavigation.Tab.search)

            NavigationStack {
                AnimeCatalogView()
                    .navigationDestination(for: AUAnime.self) { AnimeDetailView(anime: $0) }
                    .toolbarActions()
                    .background { AmbientBackground() }
            }
            .tabItem { Label("Anime", systemImage: "sparkles.tv.fill") }
            .tag(AppNavigation.Tab.anime)

            NavigationStack {
                WatchlistView()
                    .navigationDestination(for: MediaRef.self) { DetailView(ref: $0) }
                    .toolbarActions()
                    .background { AmbientBackground() }
            }
            .tabItem { Label("Lista", systemImage: "bookmark.fill") }
            .tag(AppNavigation.Tab.watchlist)
        }
    }

    /// Offline mode collapses the app to the one thing that still works:
    /// the Downloads list (with Settings reachable for local-only options).
    private var offlineRoot: some View {
        NavigationStack {
            DownloadsView()
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { nav.presentedSheet = .settings } label: { Image(systemName: "gearshape") }
                            .accessibilityLabel("Impostazioni")
                    }
                }
                .background { AmbientBackground() }
        }
    }

    /// streamo://open?type=tv&id=123&s=1&e=2 → open the title's detail.
    private func handleDeepLink(_ url: URL) {
        guard url.scheme == "streamo",
              let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return }
        let q = comps.queryItems ?? []
        func value(_ name: String) -> String? { q.first { $0.name == name }?.value }
        guard let id = value("id").flatMap(Int.init),
              let typeRaw = value("type"), let type = MediaType(rawValue: typeRaw) else { return }
        // Offline mode only renders Downloads, so a tab/stack-based open would
        // silently land nowhere. Surface that to the user instead.
        guard network.isOnline else {
            ToastCenter.shared.show("Sei offline — apertura disponibile al ritorno della connessione")
            return
        }
        let season = value("s").flatMap(Int.init) ?? 0
        let episode = value("e").flatMap(Int.init) ?? 0
        nav.open(MediaRef(tmdbId: id, mediaType: type, resumeSeason: season, resumeEpisode: episode))
    }
}
