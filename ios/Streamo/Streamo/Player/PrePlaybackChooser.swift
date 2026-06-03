import SwiftUI

/// Pre-playback quality chooser shown over the blurred title artwork for a few
/// seconds before streaming begins. The user can pick a one-off resolution; a
/// ring around the play button drains over the countdown and auto-starts when
/// it empties. Tapping the ring (or any chip then the ring) starts immediately.
/// Only used for streaming — offline downloads have a fixed resolution, so the
/// caller skips this entirely for them.
struct PrePlaybackChooser: View {
    let title: String
    let subtitle: String?
    let seconds: Int
    /// The chosen max height (0 = Auto). Bound to the player so the value is
    /// applied whether the user taps "start now" or lets the countdown expire.
    @Binding var selected: Int
    /// Fired once — on tap or when the countdown reaches zero.
    let onStart: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var remaining: Int
    @State private var ring: CGFloat = 1   // 1 → 0 as the countdown drains
    @State private var fired = false

    private static let options: [(label: String, height: Int)] =
        [("Auto", 0), ("1080p", 1080), ("720p", 720), ("480p", 480)]

    init(title: String, subtitle: String?, seconds: Int, selected: Binding<Int>, onStart: @escaping () -> Void) {
        self.title = title
        self.subtitle = subtitle
        self.seconds = seconds
        self._selected = selected
        self.onStart = onStart
        self._remaining = State(initialValue: seconds)
    }

    var body: some View {
        VStack(spacing: 26) {
            header
            qualityPicker
            countdownButton
            Text("Avvio automatico tra \(remaining)s")
                .font(.footnote)
                .foregroundStyle(.white.opacity(0.6))
                .monospacedDigit()
                .contentTransition(.numericText())
        }
        .padding(.horizontal, 28)
        .frame(maxWidth: 460)
        .task { await runCountdown() }
    }

    // MARK: - Pieces

    private var header: some View {
        VStack(spacing: 6) {
            Text(title)
                .font(.title3.bold())
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .lineLimit(2)
            if let subtitle {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.7))
            }
        }
    }

    private var qualityPicker: some View {
        VStack(spacing: 12) {
            Text("Scegli la qualità")
                .font(.caption.weight(.semibold))
                .textCase(.uppercase)
                .tracking(0.5)
                .foregroundStyle(.white.opacity(0.55))
            HStack(spacing: 10) {
                ForEach(Self.options, id: \.height) { opt in
                    FilterChip(label: opt.label, selected: selected == opt.height, compact: true) {
                        selected = opt.height
                    }
                }
            }
        }
    }

    /// The "tasto che si svuota": a ring that drains over the countdown, with a
    /// play glyph inside. Tapping it starts playback right away.
    private var countdownButton: some View {
        Button(action: fire) {
            ZStack {
                Circle().fill(.black.opacity(0.35))
                Circle().stroke(.white.opacity(0.16), lineWidth: 5)
                Circle()
                    .trim(from: 0, to: ring)
                    .stroke(Theme.red, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Image(systemName: "play.fill")
                    .font(.system(size: 32, weight: .bold))
                    .foregroundStyle(.white)
                    .offset(x: 2)   // optical centering of the triangle
            }
            .frame(width: 92, height: 92)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Riproduci ora")
        .accessibilityHint("Avvio automatico tra \(remaining) secondi")
    }

    // MARK: - Countdown

    private func runCountdown() async {
        // Smooth drain for the ring; the integer label ticks once per second.
        // Reduce Motion keeps the number countdown but skips the sweep.
        if reduceMotion {
            ring = 0
        } else {
            withAnimation(.linear(duration: Double(seconds))) { ring = 0 }
        }
        for _ in 0..<seconds {
            try? await Task.sleep(for: .seconds(1))
            if fired { return }
            withAnimation(.snappy(duration: 0.2)) { remaining = max(0, remaining - 1) }
        }
        fire()
    }

    private func fire() {
        guard !fired else { return }
        fired = true
        onStart()
    }
}
