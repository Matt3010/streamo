import SwiftUI

/// Unified button styles — port of the web `ui-button` system.
/// `.primary` = red gradient CTA, `.secondary` = white-tint with hairline border.
/// Use via `.buttonStyle(BrandButtonStyle(.primary))`.
struct BrandButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary }

    var kind: Kind = .primary
    var fullWidth: Bool = true

    func makeBody(configuration: Configuration) -> some View {
        BrandButtonBody(kind: kind, fullWidth: fullWidth, configuration: configuration)
    }

    private struct BrandButtonBody: View {
        let kind: Kind
        let fullWidth: Bool
        let configuration: ButtonStyleConfiguration
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            configuration.label
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: fullWidth ? .infinity : nil)
                .padding(.vertical, 13)
                .padding(.horizontal, 18)
                .background(background)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(.white.opacity(kind == .secondary ? 0.12 : 0))
                )
                .shadow(color: kind == .primary ? Theme.red.opacity(0.22) : .clear, radius: 12, y: 6)
                .opacity(isEnabled ? (configuration.isPressed ? 0.88 : 1) : 0.56)
                .scaleEffect(configuration.isPressed ? 0.985 : 1)
                .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
        }

        @ViewBuilder
        private var background: some View {
            switch kind {
            case .primary:
                LinearGradient(colors: [Theme.red, Theme.redBright], startPoint: .topLeading, endPoint: .bottomTrailing)
            case .secondary:
                Rectangle().fill(.ultraThinMaterial)
                    .overlay(Color.white.opacity(configuration.isPressed ? 0.10 : 0))
            }
        }
    }
}
