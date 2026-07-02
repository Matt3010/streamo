import SwiftUI

/// UI text literals shared across screens, so the same copy isn't re-typed
/// (and can't drift) at each call site.
enum UIText {
    /// Card/title fallback when a title is missing or empty.
    static let untitled = "Senza titolo"
    /// Watchlist toggle copy.
    static let addToList = "Aggiungi alla lista"
    static let removeFromList = "Rimuovi dalla lista"
}

extension View {
    /// The app's liquid-glass panel surface: a tinted glass fill plus a hairline
    /// white stroke on a single rounded-rect shape. One definition so the corner
    /// radius / tint / stroke can't drift apart across screens (each call still
    /// passes its own radius; tint/stroke default to the common values).
    func glassPanel(cornerRadius: CGFloat, tint: Double = 0.06, stroke: Double = 0.10) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        return self
            .background { LiquidGlassBackground(shape: shape, tint: Theme.red.opacity(tint)) }
            .overlay(shape.strokeBorder(.white.opacity(stroke)))
    }
}

extension Binding where Value == Bool {
    /// Bridges an optional-item binding to the `Bool` an `isPresented:` modifier
    /// wants: true while the item is set, and clearing the item when dismissed.
    /// Replaces the hand-rolled `Binding(get:set:)` repeated at each
    /// confirmation dialog.
    static func isPresent<T>(_ item: Binding<T?>) -> Binding<Bool> {
        Binding(get: { item.wrappedValue != nil },
                set: { if !$0 { item.wrappedValue = nil } })
    }
}
