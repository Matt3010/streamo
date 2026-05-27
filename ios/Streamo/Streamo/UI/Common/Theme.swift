import SwiftUI

/// Visual identity matching the original web app: dark background + vivid red.
enum Theme {
    /// Brand red (#E50914) — accent for progress bars, status text, badges.
    static let red = Color(red: 0.898, green: 0.035, blue: 0.078)
    /// Lighter red used as the second stop of the primary-button gradient (#FF3B30).
    static let redBright = Color(red: 1.0, green: 0.231, blue: 0.188)
}

extension Color {
    static let brand = Theme.red
}

/// Popularity badge ("🔥 1.234") shown on the detail page — port of the web
/// MediaRankBadge. `value` is the pre-formatted popularity string.
struct MediaRankBadge: View {
    let value: String

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "flame.fill").foregroundStyle(.orange)
            Text(value).font(.subheadline.weight(.semibold)).foregroundStyle(.white)
        }
        .padding(.horizontal, 12).padding(.vertical, 6)
        .background(.black.opacity(0.55), in: Capsule())
        .overlay(Capsule().strokeBorder(.white.opacity(0.12)))
    }
}

/// Section header: a red rounded-square icon badge next to a bold title — the
/// signature row header from the web home.
struct SectionHeader: View {
    let title: String
    let symbol: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(Theme.red, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            Text(title)
                .font(.title3.bold())
                .foregroundStyle(.white)
        }
        .padding(.horizontal)
    }
}
