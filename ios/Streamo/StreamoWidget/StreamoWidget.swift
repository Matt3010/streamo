import WidgetKit
import SwiftUI

// "Continua a guardare" widget. Reads the snapshot the app writes into the
// shared App Group (WidgetShared) — add WidgetSnapshot.swift to this target too.

struct ContinueEntry: TimelineEntry {
    let date: Date
    let item: WidgetShared.ContinueItem?
    let image: Image?
}

struct ContinueProvider: TimelineProvider {
    func placeholder(in context: Context) -> ContinueEntry {
        ContinueEntry(date: .now, item: nil, image: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (ContinueEntry) -> Void) {
        Task { completion(await makeEntry(family: context.family)) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ContinueEntry>) -> Void) {
        Task {
            let entry = await makeEntry(family: context.family)
            completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(3600))))
        }
    }

    /// Bigger widgets get a higher-resolution poster (small is ~158pt wide @3x
    /// ≈ 474px, large ≈ 1116px), so we pick the closest TMDB size.
    private func posterSize(for family: WidgetFamily) -> WidgetShared.PosterSize {
        switch family {
        case .systemLarge:  return .w780
        case .systemMedium: return .w500
        default:            return .w342
        }
    }

    private func makeEntry(family: WidgetFamily) async -> ContinueEntry {
        let item = WidgetShared.loadContinue().first
        var image: Image?
        if let url = WidgetShared.posterURL(item?.poster, size: posterSize(for: family)),
           let (data, _) = try? await URLSession.shared.data(from: url),
           let ui = UIImage(data: data) {
            image = Image(uiImage: ui)
        }
        return ContinueEntry(date: .now, item: item, image: image)
    }
}

private let brandRed = Color(red: 0.898, green: 0.035, blue: 0.078)

struct StreamoWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ContinueEntry

    var body: some View {
        if let item = entry.item {
            content(item)
                .widgetURL(WidgetShared.deepLink(item))
        } else {
            empty
        }
    }

    /// Same layout for every size: the cover fills the whole widget and the
    /// details sit in an overlay at the bottom over a gradient. Fonts and
    /// spacing scale up with the family.
    private func content(_ item: WidgetShared.ContinueItem) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer(minLength: 0)
            details(item)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
        .containerBackground(for: .widget) { posterBackground }
    }

    private func details(_ item: WidgetShared.ContinueItem) -> some View {
        let large = family == .systemLarge
        let medium = family == .systemMedium
        return VStack(alignment: .leading, spacing: large ? 8 : 5) {
            Text(item.title)
                .font(large ? .title2.bold() : (medium ? .title3.bold() : .subheadline.bold()))
                .foregroundStyle(.white)
                .lineLimit(large ? 3 : 2)
                .shadow(color: .black.opacity(0.5), radius: 3, y: 1)

            if item.isTV {
                Text((medium || large) ? "Stagione \(item.season) · Episodio \(item.episode)"
                                       : "S\(item.season) · E\(item.episode)")
                    .font(large ? .headline : (medium ? .subheadline : .caption))
                    .foregroundStyle(.white.opacity(0.85))
                    .shadow(color: .black.opacity(0.5), radius: 2, y: 1)
            }

            if Int(item.percent.rounded()) > 0 {
                HStack(spacing: 8) {
                    progress(item.percent)
                    Text("\(Int(item.percent.rounded()))%")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.9))
                        .fixedSize()
                }
                .padding(.top, 2)
            }
        }
        .padding(.horizontal, large ? 18 : 14)
        .padding(.bottom, large ? 18 : 14)
        .padding(.top, 40)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(colors: [.clear, .black.opacity(0.55), .black.opacity(0.92)],
                           startPoint: .top, endPoint: .bottom)
        )
    }

    // MARK: Pieces

    /// The cover image cropped to fill the whole widget (any family).
    private var posterBackground: some View {
        Group {
            if let image = entry.image {
                image.resizable().scaledToFill()
            } else {
                LinearGradient(colors: [Color(red: 0.18, green: 0.02, blue: 0.04), .black],
                               startPoint: .top, endPoint: .bottom)
            }
        }
    }

    private func progress(_ percent: Double) -> some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.3))
                Capsule().fill(brandRed)
                    .frame(width: max(3, geo.size.width * percent / 100))
            }
        }
        .frame(height: 5)
    }

    private var empty: some View {
        VStack(spacing: 8) {
            Image(systemName: "play.circle.fill").font(.largeTitle).foregroundStyle(brandRed)
            Text("Niente da riprendere")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .containerBackground(.black, for: .widget)
    }
}

/// Named `StreamoWidget` so the Xcode-generated `StreamoWidgetBundle` (which
/// has the @main and references `StreamoWidget()`) keeps working as-is.
struct StreamoWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StreamoContinue", provider: ContinueProvider()) { entry in
            StreamoWidgetView(entry: entry)
        }
        .configurationDisplayName("Continua a guardare")
        .description("Riprendi l'ultimo titolo che stavi guardando.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}
