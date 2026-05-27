import SwiftUI
import UIKit

/// Visual identity: dark background + a user-selectable accent (default = the
/// web brand red #E50914). `red`/`redBright` are computed from the chosen
/// accent in AppSettings, so picking a new colour re-tints the whole app —
/// every view reading `Theme.red` in its body observes the accent and refreshes.
enum Theme {
    /// The accent — historical name kept so existing call sites don't change.
    static var red: Color {
        let s = AppSettings.shared
        return Color(red: s.accentR, green: s.accentG, blue: s.accentB)
    }
    /// A lighter accent for the primary-button gradient's second stop.
    static var redBright: Color {
        let s = AppSettings.shared
        return Color(red: min(1, s.accentR + 0.22), green: min(1, s.accentG + 0.18), blue: min(1, s.accentB + 0.16))
    }
    /// Very dark accent for the ambient page background wash (kept subtle).
    static var accentWash: Color {
        let s = AppSettings.shared
        return Color(red: s.accentR * 0.13, green: s.accentG * 0.13, blue: s.accentB * 0.13)
    }

    /// Preset swatches offered in Settings.
    static let accentPresets: [Color] = [
        Color(red: 0.898, green: 0.035, blue: 0.078),  // Streamo red (default)
        Color(red: 1.0, green: 0.42, blue: 0.21),      // orange
        Color(red: 0.96, green: 0.76, blue: 0.06),     // amber
        Color(red: 0.20, green: 0.78, blue: 0.35),     // green
        Color(red: 0.04, green: 0.52, blue: 1.0),      // blue
        Color(red: 0.69, green: 0.32, blue: 0.87),     // purple
        Color(red: 1.0, green: 0.18, blue: 0.57),      // pink
    ]

    /// Persist a chosen accent (extracts sRGB components from the Color).
    static func setAccent(_ color: Color) {
        let c = color.resolve(in: EnvironmentValues())
        let s = AppSettings.shared
        s.accentR = Double(c.red); s.accentG = Double(c.green); s.accentB = Double(c.blue)
        UIRefreshControl.appearance().tintColor =
            UIColor(red: CGFloat(c.red), green: CGFloat(c.green), blue: CGFloat(c.blue), alpha: 1)
    }
}

extension Color {
    static var brand: Color { Theme.red }
}

/// Ambient page background: a dark gradient (faint red tint up top, fading to
/// black) that gives the glass/material surfaces something to refract — over
/// pure black a material looks flat. Use behind the main tabs' scroll content.
///
/// To switch to blurred artwork instead, replace the body with a darkened,
/// blurred `AsyncImage` of a featured poster.
struct AmbientBackground: View {
    var body: some View {
        LinearGradient(
            colors: [
                Theme.accentWash,                           // subtle accent wash (top-left)
                Color(red: 0.03, green: 0.03, blue: 0.04),
                .black,
            ],
            startPoint: .topLeading, endPoint: .bottomTrailing
        )
        .ignoresSafeArea()
    }
}

/// Popularity badge ("🔥 1.234") shown on the detail page — port of the web
/// MediaRankBadge. `value` is the pre-formatted popularity string.
struct MediaRankBadge: View {
    let value: String

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "flame.fill").foregroundStyle(.orange)
            Text(value).font(.subheadline.weight(.semibold)).foregroundStyle(.white).lineLimit(1)
        }
        .padding(.horizontal, 12).padding(.vertical, 6)
        .background(.black.opacity(0.55), in: Capsule())
        .overlay(Capsule().strokeBorder(.white.opacity(0.12)))
        // Keep its intrinsic size so a long nav-bar title truncates instead of
        // squashing / wrapping the pill.
        .fixedSize()
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
