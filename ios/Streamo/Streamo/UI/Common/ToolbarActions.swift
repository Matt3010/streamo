import SwiftUI
import AVKit

/// A single overflow toolbar button (the brand-tinted "•••" glyph) that opens a
/// native `Menu` with the utility actions: AirPlay, Download, Cronologia,
/// Impostazioni. A `Menu` (rather than a popover) is used because its open/close
/// is reliable and it dismisses cleanly before the destination sheet presents.
///
/// The live download status (count badge, progress %, failure warning) is shown
/// both on the collapsed button AND inside the Download row, so it's visible
/// either way.
struct ToolbarActions: ViewModifier {
    @Environment(AppNavigation.self) private var nav
    @Environment(Library.self) private var library
    @State private var downloads = DownloadManager.shared
    @State private var airplay = AirPlayLauncher()

    private var activeDownloads: [DownloadEntry] {
        library.downloads().filter { entry in
            switch downloads.displayState(for: entry) {
            case .queued, .downloading, .paused: return true
            case .completed, .failed: return false
            }
        }
    }

    private var progressPercent: Int {
        let entries = activeDownloads
        guard !entries.isEmpty else { return 0 }
        let total = entries.reduce(0) { $0 + downloads.progress(for: $1) }
        return Int((min(1, max(0, total / Double(entries.count))) * 100).rounded())
    }

    private var isReconstructing: Bool {
        activeDownloads.contains { downloads.isReconstructingProgress(for: $0) }
    }

    private var hasFailed: Bool {
        library.downloads().contains { $0.state == .failed }
    }

    func body(content: Content) -> some View {
        let _ = library.version
        let count = activeDownloads.count
        let percent = progressPercent
        let reconstructing = isReconstructing
        let failed = hasFailed

        content
            // Hidden native AirPlay picker kept in the hierarchy so the menu's
            // AirPlay row can trigger the system route chooser.
            .background(
                AirPlayProxy(launcher: airplay)
                    .frame(width: 1, height: 1)
                    .opacity(0.02)
                    .allowsHitTesting(false)
            )
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { airplay.present() } label: {
                            Label("AirPlay", systemImage: "airplayvideo")
                        }
                        Button { nav.presentedSheet = .downloads } label: {
                            Label(downloadRowTitle(count: count, percent: percent, reconstructing: reconstructing),
                                  systemImage: failed ? "exclamationmark.triangle.fill" : "arrow.down.circle")
                        }
                        Button { nav.presentedSheet = .history } label: {
                            Label("Cronologia", systemImage: "clock.arrow.circlepath")
                        }
                        Button { nav.presentedSheet = .settings } label: {
                            Label("Impostazioni", systemImage: "gearshape")
                        }
                    } label: {
                        menuLabel(count: count, percent: percent, reconstructing: reconstructing, failed: failed)
                    }
                    .accessibilityLabel("Altre azioni")
                }
            }
    }

    private func downloadRowTitle(count: Int, percent: Int, reconstructing: Bool) -> String {
        guard count > 0 else { return "Download" }
        if reconstructing { return "Download · ricostruzione…" }
        return "Download · \(percent)%"
    }

    /// The collapsed button: overflow glyph with the live download badge / % /
    /// warning overlaid, so the status is visible without opening the menu.
    @ViewBuilder
    private func menuLabel(count: Int, percent: Int, reconstructing: Bool, failed: Bool) -> some View {
        HStack(spacing: 5) {
            ZStack(alignment: .center) {
                Image(systemName: "ellipsis.circle")
                    .foregroundStyle(Theme.red)
                if count > 0 {
                    Text(count > 99 ? "99+" : "\(count)")
                        .font(.system(size: 9, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .minimumScaleFactor(0.7)
                        .lineLimit(1)
                        .frame(minWidth: 14, minHeight: 14)
                        .padding(.horizontal, count > 9 ? 3 : 0)
                        .background { Capsule().fill(Theme.red) }
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                }
                if failed {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 11))
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(.white, .orange)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                }
            }
            .frame(width: count > 9 ? 32 : 28, height: 26)

            if count > 0 {
                Text(reconstructing ? "…" : "\(percent)%")
                    .font(.caption2.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
        }
    }
}

extension View {
    func toolbarActions() -> some View { modifier(ToolbarActions()) }
}

// MARK: - AirPlay

/// Holds the closure that triggers the hidden AirPlay picker, set by
/// `AirPlayProxy` once it's in the view hierarchy.
@MainActor
final class AirPlayLauncher {
    var trigger: () -> Void = {}
    func present() { trigger() }
}

/// A near-invisible native `AVRoutePickerView` kept in the hierarchy. SwiftUI's
/// `Menu` can't host a live picker, so we present the system route chooser by
/// programmatically tapping this picker's internal button.
private struct AirPlayProxy: UIViewRepresentable {
    let launcher: AirPlayLauncher

    func makeUIView(context: Context) -> AVRoutePickerView {
        let picker = AVRoutePickerView()
        picker.prioritizesVideoDevices = true
        launcher.trigger = { [weak picker] in
            guard let picker else { return }
            Self.button(in: picker)?.sendActions(for: .touchUpInside)
        }
        return picker
    }

    func updateUIView(_ uiView: AVRoutePickerView, context: Context) {}

    private static func button(in view: UIView) -> UIButton? {
        if let button = view as? UIButton { return button }
        for sub in view.subviews {
            if let button = button(in: sub) { return button }
        }
        return nil
    }
}
