import Foundation
import Observation

/// App-level navigation state — lets child views switch the active tab
/// (e.g. an empty-state "Vai a cercare") and lets a tapped notification deep
/// link into a title's detail page. Singleton so the notification delegate and
/// the views share the same instance.
@MainActor
@Observable
final class AppNavigation {
    static let shared = AppNavigation()

    enum Tab: Hashable { case home, search, watchlist, history, settings }

    var selectedTab: Tab = .home
    /// Navigation path for the Home tab's stack (used for deep links).
    var homePath: [MediaRef] = []

    private init() {}

    /// Open a title's detail: switch to Home and push it onto the stack.
    func open(_ ref: MediaRef) {
        selectedTab = .home
        homePath = [ref]
    }
}
