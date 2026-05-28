import SwiftUI
import SwiftData
import UIKit

@main
struct StreamoApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    /// On-device store for watchlist / progress / history / provider mappings.
    private let modelContainer: ModelContainer
    @State private var library: Library
    private let navigation = AppNavigation.shared

    init() {
        let schema = Schema([
            WatchlistEntry.self,
            ProgressEntry.self,
            HistoryEntry.self,
            ProviderMapping.self,
            DownloadEntry.self,
        ])
        // Local-only store. Sync across devices is not used; the user can
        // back up / restore the library manually from Settings.
        guard let container = try? ModelContainer(
            for: schema,
            configurations: [ModelConfiguration(schema: schema, isStoredInMemoryOnly: false)]
        ) else {
            fatalError("Impossibile creare il ModelContainer")
        }
        modelContainer = container
        _library = State(initialValue: Library(context: container.mainContext))

        // SwiftUI's pull-to-refresh spinner ignores `.tint`; color it via the
        // UIKit appearance proxy so it shows the accent instead of grey.
        let a = AppSettings.shared
        UIRefreshControl.appearance().tintColor =
            UIColor(red: a.accentR, green: a.accentG, blue: a.accentB, alpha: 1)
    }

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .tint(Theme.red)
                .preferredColorScheme(.dark)
                .environment(library)
                .environment(navigation)
        }
        .modelContainer(modelContainer)
    }
}
