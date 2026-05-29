import ActivityKit
import WidgetKit
import SwiftUI

/// Lock-screen banner + Dynamic Island presentation for a download session.
/// State is pushed by `DownloadActivityController` in the app.
struct DownloadLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: DownloadActivityAttributes.self) { context in
            // Lock screen / banner.
            LockScreenView(state: context.state)
                .padding()
                .activityBackgroundTint(Color.black.opacity(0.6))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            let style = PhaseStyle(context.state.phase)
            return DynamicIsland {
                // Keep only small glyphs in the squeezed leading/trailing
                // slots; the title, subtitle and progress bar live in the
                // full-width bottom region so nothing gets clipped by the
                // sensor-housing insets.
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: style.icon)
                        .font(.title3)
                        .foregroundStyle(style.color)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("\(percent(context.state.progress))%")
                        .font(.headline.monospacedDigit())
                        .foregroundStyle(.white)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(context.state.title)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                        if let subtitle = context.state.subtitle {
                            Text(subtitle)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        ProgressView(value: context.state.progress)
                            .tint(style.color)
                        Text(statusText(context.state))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } compactLeading: {
                Image(systemName: style.icon)
                    .foregroundStyle(style.color)
            } compactTrailing: {
                Text("\(percent(context.state.progress))%")
                    .font(.caption2.monospacedDigit())
            } minimal: {
                Image(systemName: style.icon)
                    .foregroundStyle(style.color)
            }
            .keylineTint(style.color)
        }
    }
}

/// Lock-screen layout: icon + percent on top, then title / subtitle / progress
/// / status stacked full-width so nothing clips against the rounded edges.
private struct LockScreenView: View {
    let state: DownloadActivityAttributes.ContentState

    var body: some View {
        let style = PhaseStyle(state.phase)
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: style.icon)
                    .font(.title3)
                    .foregroundStyle(style.color)
                Spacer()
                Text("\(percent(state.progress))%")
                    .font(.title3.monospacedDigit().weight(.bold))
                    .foregroundStyle(.white)
            }
            Text(state.title)
                .font(.headline)
                .foregroundStyle(.white)
                .lineLimit(1)
            if let subtitle = state.subtitle {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.7))
                    .lineLimit(1)
            }
            ProgressView(value: state.progress)
                .tint(style.color)
            Text(statusText(state))
                .font(.caption)
                .foregroundStyle(.white.opacity(0.7))
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Phase styling

private struct PhaseStyle {
    let icon: String
    let color: Color

    init(_ phase: DownloadActivityAttributes.Phase) {
        switch phase {
        case .downloading:
            icon = "arrow.down.circle.fill"; color = .blue
        case .paused:
            icon = "pause.circle.fill"; color = .orange
        case .failed:
            icon = "exclamationmark.triangle.fill"; color = .red
        case .completed:
            icon = "checkmark.circle.fill"; color = .green
        }
    }
}

private func percent(_ progress: Double) -> Int {
    Int((progress * 100).rounded())
}

private func statusText(_ state: DownloadActivityAttributes.ContentState) -> String {
    switch state.phase {
    case .downloading:
        return state.queuedCount > 0
            ? "Download in corso · altri \(state.queuedCount) in coda"
            : "Download in corso"
    case .paused:
        return state.queuedCount > 0
            ? "In pausa · altri \(state.queuedCount) in coda"
            : "In pausa"
    case .failed:
        return "Download non riuscito"
    case .completed:
        return "Download completato"
    }
}
