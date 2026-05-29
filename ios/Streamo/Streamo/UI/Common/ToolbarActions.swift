import SwiftUI

/// The shared utility toolbar (Cronologia / Impostazioni / Download) shown on
/// every tab's navigation bar. The buttons set `AppNavigation.presentedSheet`;
/// the sheet itself is presented once at the root (`RootTabView`), so it's
/// available no matter which tab you're on.
struct ToolbarActions: ViewModifier {
    @Environment(AppNavigation.self) private var nav
    @Environment(Library.self) private var library

    func body(content: Content) -> some View {
        let _ = library.version
        content.toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                HStack(spacing: 12) {
                    Button { nav.presentedSheet = .settings } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel("Impostazioni")
                    Button { nav.presentedSheet = .history } label: { Image(systemName: "clock.arrow.circlepath") }
                        .accessibilityLabel("Cronologia")
                    DownloadToolbarButton {
                        nav.presentedSheet = .downloads
                    }
                }
            }
        }
    }
}

extension View {
    func toolbarActions() -> some View { modifier(ToolbarActions()) }
}

private struct DownloadToolbarButton: View {
    @Environment(Library.self) private var library
    @State private var downloads = DownloadManager.shared

    let action: () -> Void

    private var activeDownloads: [DownloadEntry] {
        library.downloads().filter { entry in
            switch downloads.displayState(for: entry) {
            case .queued, .downloading, .paused:
                return true
            case .completed, .failed:
                return false
            }
        }
    }

    private var aggregateProgress: Double {
        let entries = activeDownloads
        guard !entries.isEmpty else { return 0 }
        let total = entries.reduce(0) { $0 + downloads.progress(for: $1) }
        return min(1, max(0, total / Double(entries.count)))
    }

    private var progressPercent: Int {
        Int((aggregateProgress * 100).rounded())
    }

    private var isReconstructingAnyProgress: Bool {
        activeDownloads.contains { downloads.isReconstructingProgress(for: $0) }
    }

    var body: some View {
        let _ = library.version
        let count = activeDownloads.count

        Button(action: action) {
            HStack(spacing: 5) {
                ZStack(alignment: .center) {
                    Image(systemName: "arrow.down.circle")
                        .font(.body)
                        .foregroundStyle(Theme.red)
                    if count > 0 {
                        Text(count > 99 ? "99+" : "\(count)")
                            .font(.system(size: 9, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)
                            .minimumScaleFactor(0.7)
                            .lineLimit(1)
                            .frame(minWidth: 14, minHeight: 14)
                            .padding(.horizontal, count > 9 ? 3 : 0)
                            .background {
                                Capsule().fill(Theme.red)
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    }
                }
                .frame(width: count > 9 ? 32 : 28, height: 26)

                if count > 0 {
                    Text(isReconstructingAnyProgress ? "..." : "\(progressPercent)%")
                        .font(.caption2.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                        .frame(minWidth: 28, alignment: .leading)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel(count: count))
    }

    private func accessibilityLabel(count: Int) -> String {
        guard count > 0 else { return "Download" }
        if isReconstructingAnyProgress {
            return "Download, \(count) attivi, ricostruzione progresso in corso"
        }
        return "Download, \(count) in coda, progresso \(progressPercent)%"
    }
}
