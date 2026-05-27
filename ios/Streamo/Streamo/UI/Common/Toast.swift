import SwiftUI
import Observation

/// Lightweight transient confirmations ("Aggiunto alla lista", …) — the native
/// equivalent of the web app's toast service.
@MainActor
@Observable
final class ToastCenter {
    static let shared = ToastCenter()
    private(set) var message: String?
    private var token = 0

    private init() {}

    func show(_ text: String) {
        message = text
        token &+= 1
        let current = token
        Task {
            try? await Task.sleep(for: .seconds(2.2))
            if current == token { message = nil }
        }
    }
}

private struct ToastOverlay: ViewModifier {
    private var center = ToastCenter.shared

    func body(content: Content) -> some View {
        content.overlay(alignment: .bottom) {
            if let msg = center.message {
                Text(msg)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(.black.opacity(0.85), in: Capsule())
                    .shadow(radius: 8, y: 2)
                    .padding(.bottom, 92)   // clear the bottom tab bar
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(duration: 0.3), value: center.message)
    }
}

extension View {
    /// Shows ToastCenter messages along the bottom edge.
    func toastOverlay() -> some View { modifier(ToastOverlay()) }
}
