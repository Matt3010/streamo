import ActivityKit
import WidgetKit
import SwiftUI

/// Lock-screen banner + Dynamic Island presentation for an in-progress
/// download. State is pushed by `DownloadActivityController` in the app.
struct DownloadLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: DownloadActivityAttributes.self) { context in
            // Lock screen / banner.
            LockScreenView(context: context)
                .padding()
                .activityBackgroundTint(Color.black.opacity(0.6))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: context.state.isFinished
                          ? "checkmark.circle.fill" : "arrow.down.circle.fill")
                        .font(.title2)
                        .foregroundStyle(context.state.isFinished ? .green : .blue)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("\(Int((context.state.progress * 100).rounded()))%")
                        .font(.headline.monospacedDigit())
                        .foregroundStyle(.white)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.attributes.title)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                        if let subtitle = context.attributes.subtitle {
                            Text(subtitle)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 4) {
                        ProgressView(value: context.state.progress)
                            .tint(.blue)
                        Text(statusText(context))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            } compactLeading: {
                Image(systemName: context.state.isFinished
                      ? "checkmark.circle.fill" : "arrow.down.circle.fill")
                    .foregroundStyle(context.state.isFinished ? .green : .blue)
            } compactTrailing: {
                Text("\(Int((context.state.progress * 100).rounded()))%")
                    .font(.caption2.monospacedDigit())
            } minimal: {
                ProgressView(value: context.state.progress)
                    .progressViewStyle(.circular)
                    .tint(.blue)
            }
            .keylineTint(.blue)
        }
    }

    private func statusText(_ context: ActivityViewContext<DownloadActivityAttributes>) -> String {
        if context.state.queuedCount > 0 {
            return "\(context.state.statusLabel) · altri \(context.state.queuedCount) in coda"
        }
        return context.state.statusLabel
    }
}

private struct LockScreenView: View {
    let context: ActivityViewContext<DownloadActivityAttributes>

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: context.state.isFinished
                  ? "checkmark.circle.fill" : "arrow.down.circle.fill")
                .font(.title)
                .foregroundStyle(context.state.isFinished ? .green : .blue)
            VStack(alignment: .leading, spacing: 4) {
                Text(context.attributes.title)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                if let subtitle = context.attributes.subtitle {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.7))
                        .lineLimit(1)
                }
                ProgressView(value: context.state.progress)
                    .tint(.blue)
                HStack {
                    Text(context.state.queuedCount > 0
                         ? "\(context.state.statusLabel) · altri \(context.state.queuedCount) in coda"
                         : context.state.statusLabel)
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.7))
                    Spacer()
                    Text("\(Int((context.state.progress * 100).rounded()))%")
                        .font(.caption.monospacedDigit().weight(.semibold))
                        .foregroundStyle(.white)
                }
            }
        }
    }
}
