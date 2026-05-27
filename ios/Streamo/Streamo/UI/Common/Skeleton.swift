import SwiftUI

/// Shimmering placeholder box — port of the web `.skeleton` (animated gradient
/// between surface and surface-hover, 1.4s loop).
struct SkeletonBox: View {
    var cornerRadius: CGFloat = 10
    @State private var animate = false

    var body: some View {
        GeometryReader { geo in
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(Color(.secondarySystemBackground))
                .overlay(
                    LinearGradient(colors: [.clear, .white.opacity(0.10), .clear],
                                   startPoint: .leading, endPoint: .trailing)
                        .frame(width: geo.size.width * 0.7)
                        .offset(x: animate ? geo.size.width * 1.2 : -geo.size.width * 1.2)
                )
                .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        }
        .onAppear {
            withAnimation(.linear(duration: 1.4).repeatForever(autoreverses: false)) { animate = true }
        }
    }
}

/// A 2:3 skeleton poster card matching `MediaCard` sizing.
struct SkeletonCard: View {
    var width: CGFloat? = nil

    var body: some View {
        SkeletonBox()
            .aspectRatio(2.0/3.0, contentMode: .fit)
            .frame(width: width)
    }
}
