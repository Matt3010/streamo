import SwiftUI

/// Static placeholder box with the same dark, glossy feel as the app cards.
struct SkeletonBox: View {
    var cornerRadius: CGFloat = 10

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        shape
            .fill(
                LinearGradient(
                    colors: [
                        Color(.secondarySystemBackground).opacity(0.78),
                        Color(.tertiarySystemBackground).opacity(0.58),
                        Color(.secondarySystemBackground).opacity(0.72),
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(
                LinearGradient(
                    colors: [.white.opacity(0.08), .clear],
                    startPoint: .top,
                    endPoint: .center
                )
                .clipShape(shape)
            )
            .overlay(shape.strokeBorder(.white.opacity(0.06)))
    }
}

/// A 2:3 skeleton poster card matching `MediaCard` sizing.
struct SkeletonCard: View {
    var width: CGFloat? = nil

    var body: some View {
        SkeletonBox(cornerRadius: 10)
            .aspectRatio(2.0/3.0, contentMode: .fit)
            .frame(width: width)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(.white.opacity(0.06)))
    }
}
