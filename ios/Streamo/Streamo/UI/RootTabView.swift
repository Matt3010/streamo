import SwiftUI

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
                    case .anime:
                        AnimeCatalogView().navigationDestination(for: AUAnime.self) { AnimeDetailView(anime: $0) }
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
        // While a sheet is up it has its own overlay (above); suppress this one
        // so a toast from Settings/History/Downloads doesn't render twice.
        .toastOverlay(enabled: nav.presentedSheet == nil)
        .task {
            DownloadManager.shared.configure(library: library)
            // Warm the WARP tunnel at launch so the first playback doesn't race
            // the WireGuard handshake (which can take seconds) and fail.
            if AppSettings.shared.providerProxyActive {
                Task { try? await WarpTunnel.shared.start() }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                // The tunnel may not survive suspension — flag it so the next
                // start() re-probes and restarts instead of reusing a dead session.
                Task { await WarpTunnel.shared.invalidate() }
            case .active:
                // Re-validate and restart the tunnel before the user taps play.
                // Retries with backoff: a single start() often failed after a
                // long suspension (cold radio/handshake), leaving WARP down with
                // no retry until a manual play fail-closed.
                if AppSettings.shared.providerProxyActive {
                    Task { await WarpTunnel.shared.reconnect() }
                }
            default:
                break
            }
        }
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

}
