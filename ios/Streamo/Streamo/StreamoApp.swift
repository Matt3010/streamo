import SwiftUI
import SwiftData
import UserNotifications
import UIKit

@main
struct StreamoApp: App {
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
        // Prefer iCloud (CloudKit) sync when the capability is configured;
        // otherwise fall back to a local-only store so the app still works.
        // To enable sync: add the iCloud → CloudKit capability in Xcode
        // (Signing & Capabilities) with your team. No code change needed.
        let container: ModelContainer
        if let cloud = try? ModelContainer(
            for: schema,
            configurations: [ModelConfiguration(schema: schema, cloudKitDatabase: .automatic)]
        ) {
            container = cloud
        } else if let local = try? ModelContainer(
            for: schema,
            configurations: [ModelConfiguration(schema: schema, isStoredInMemoryOnly: false)]
        ) {
            container = local
        } else {
            fatalError("Impossibile creare il ModelContainer")
        }
        modelContainer = container
        _library = State(initialValue: Library(context: container.mainContext))

        // Route notification taps into the app (deep link to the title).
        UNUserNotificationCenter.current().delegate = NotificationDelegate.shared

        // SwiftUI's pull-to-refresh spinner ignores `.tint`; color it via the
        // UIKit appearance proxy so it shows the brand red instead of grey.
        UIRefreshControl.appearance().tintColor = UIColor(Theme.red)
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
