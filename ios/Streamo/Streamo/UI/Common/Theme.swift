import SwiftUI
import UIKit

/// Visual identity: dark background + a fixed brand accent (the web brand red
/// #E50914). `red`/`redBright` derive from `AppSettings.defaultAccent`.
enum Theme {
    /// The accent — historical name kept so existing call sites don't change.
    static var red: Color {
        let a = AppSettings.defaultAccent
        return Color(red: a.r, green: a.g, blue: a.b)
    }
    /// A lighter accent for the primary-button gradient's second stop.
    static var redBright: Color {
        let a = AppSettings.defaultAccent
        return Color(red: min(1, a.r + 0.22), green: min(1, a.g + 0.18), blue: min(1, a.b + 0.16))
    }
    /// Very dark accent for the ambient page background wash (kept subtle).
    static var accentWash: Color {
        let a = AppSettings.defaultAccent
        return Color(red: a.r * 0.13, green: a.g * 0.13, blue: a.b * 0.13)
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

struct LiquidGlassBackground<S: Shape>: View {
    let shape: S
    var tint: Color? = nil

    var body: some View {
        if #available(iOS 26.0, *) {
            shape
                .fill(.clear)
                .glassEffect(.regular.tint(tint), in: shape)
        } else {
            shape.fill(.ultraThinMaterial)
        }
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
                .lineLimit(1)
                .minimumScaleFactor(0.82)
            Spacer(minLength: 0)
        }
        .padding(.horizontal)
    }
}
