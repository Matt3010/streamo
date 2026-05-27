import SwiftUI
import WidgetKit

struct RootTabView: View {
    @Environment(Library.self) private var library
    @Environment(AppNavigation.self) private var nav
    @Environment(\.scenePhase) private var scenePhase
    @State private var network = NetworkMonitor.shared

    var body: some View {
        TabView(selection: Binding(get: { nav.selectedTab }, set: { nav.selectedTab = $0 })) {
            NavigationStack(path: Binding(get: { nav.homePath }, set: { nav.homePath = $0 })) {
                HomeView()
                    .navigationDestination(for: MediaRef.self) { DetailView(ref: $0) }
            }
            .tabItem { Label("Home", systemImage: "house.fill") }
            .tag(AppNavigation.Tab.home)

            NavigationStack {
                SearchView()
                    .navigationDestination(for: MediaRef.self) { DetailView(ref: $0) }
            }
            .tabItem { Label("Cerca", systemImage: "magnifyingglass") }
            .tag(AppNavigation.Tab.search)

            NavigationStack {
                WatchlistView()
                    .navigationDestination(for: MediaRef.self) { DetailView(ref: $0) }
            }
            .tabItem { Label("Lista", systemImage: "bookmark.fill") }
            .tag(AppNavigation.Tab.watchlist)

            NavigationStack {
                HistoryView()
                    .navigationDestination(for: MediaRef.self) { DetailView(ref: $0) }
            }
            .tabItem { Label("Cronologia", systemImage: "clock.fill") }
            .tag(AppNavigation.Tab.history)

            NavigationStack {
                SettingsView()
            }
            .tabItem { Label("Impostazioni", systemImage: "gearshape.fill") }
            .tag(AppNavigation.Tab.settings)
        }
        .safeAreaInset(edge: .top) {
            if !network.isOnline { OfflineBanner() }
        }
        .toastOverlay()
        .task { DownloadManager.shared.configure(library: library) }
        .task { await NotificationService.shared.refresh(library: library) }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                Task { await NotificationService.shared.refresh(library: library) }
            case .background:
                WidgetCenter.shared.reloadAllTimelines()
            default:
                break
            }
        }
        .onOpenURL { url in handleDeepLink(url) }
    }

    /// streamo://open?type=tv&id=123&s=1&e=2 → open the title's detail.
    private func handleDeepLink(_ url: URL) {
        guard url.scheme == "streamo",
              let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return }
        let q = comps.queryItems ?? []
        func value(_ name: String) -> String? { q.first { $0.name == name }?.value }
        guard let id = value("id").flatMap(Int.init),
              let typeRaw = value("type"), let type = MediaType(rawValue: typeRaw) else { return }
        let season = value("s").flatMap(Int.init) ?? 0
        let episode = value("e").flatMap(Int.init) ?? 0
        nav.open(MediaRef(tmdbId: id, mediaType: type, resumeSeason: season, resumeEpisode: episode))
    }
}
