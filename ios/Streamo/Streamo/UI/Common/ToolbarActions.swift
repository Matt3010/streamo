import SwiftUI

/// The shared utility toolbar (Cronologia / Impostazioni / Download) shown on
/// every tab's navigation bar. The buttons set `AppNavigation.presentedSheet`;
/// the sheet itself is presented once at the root (`RootTabView`), so it's
/// available no matter which tab you're on.
struct ToolbarActions: ViewModifier {
    @Environment(AppNavigation.self) private var nav

    func body(content: Content) -> some View {
        content.toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button { nav.presentedSheet = .history } label: { Image(systemName: "clock.arrow.circlepath") }
                    .accessibilityLabel("Cronologia")
                Button { nav.presentedSheet = .settings } label: { Image(systemName: "gearshape") }
                    .accessibilityLabel("Impostazioni")
                Button { nav.presentedSheet = .downloads } label: { Image(systemName: "arrow.down.circle") }
                    .accessibilityLabel("Download")
            }
        }
    }
}

extension View {
    func toolbarActions() -> some View { modifier(ToolbarActions()) }
}
