import SwiftUI
import UIKit

/// Netflix-style "Top 10" row: a horizontal carousel where each poster is
/// preceded by a large ghost rank number (1…10) that the poster overlaps.
struct Top10Row: View {
    let items: [HomeViewModel.HeroItem]
    @Environment(\.horizontalSizeClass) private var hSizeClass

    var body: some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title: "Top 10 oggi", symbol: "chart.bar.fill")
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 6) {
                        ForEach(Array(items.prefix(10).enumerated()), id: \.element.id) { index, hero in
                            NavigationLink(value: MediaRef(tmdbId: hero.item.id, mediaType: hero.mediaType)) {
                                Top10Cell(rank: index + 1, hero: hero,
                                          posterWidth: MediaCard.rowWidth(hSizeClass))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal)
                }
            }
        }
    }
}

private struct Top10Cell: View {
    let rank: Int
    let hero: HomeViewModel.HeroItem
    let posterWidth: CGFloat

    private var posterHeight: CGFloat { posterWidth * 1.5 }   // 2:3 poster

    var body: some View {
        HStack(alignment: .bottom, spacing: -posterWidth * 0.34) {
            // Clamp the numeral to the poster's height so it doesn't stick up
            // above the poster — otherwise the row looks like it has extra gap
            // under the section title compared to the others.
            OutlinedNumber(text: "\(rank)", fontSize: posterWidth * 1.2, strokeWidth: 1.6)
                .fixedSize()
                .frame(height: posterHeight, alignment: .bottom)
                .clipped()

            MediaCard(card: CardItem(tmdb: hero.item, type: hero.mediaType), width: posterWidth)
        }
    }
}

/// Hollow, white-outline numeral (no fill) — SwiftUI's `Text` can't stroke
/// glyphs, so we render an attributed string with a positive `strokeWidth`,
/// which draws the outline only.
private struct OutlinedNumber: UIViewRepresentable {
    let text: String
    let fontSize: CGFloat
    /// Stroke thickness as a percentage of the font size (positive = outline
    /// only).
    let strokeWidth: CGFloat

    func makeUIView(context: Context) -> UILabel {
        let label = UILabel()
        label.textAlignment = .center
        label.numberOfLines = 1
        label.backgroundColor = .clear
        label.setContentHuggingPriority(.required, for: .horizontal)
        label.setContentHuggingPriority(.required, for: .vertical)
        return label
    }

    func updateUIView(_ label: UILabel, context: Context) {
        let base = UIFont.systemFont(ofSize: fontSize, weight: .black)
        let font = base.fontDescriptor.withDesign(.rounded)
            .map { UIFont(descriptor: $0, size: fontSize) } ?? base
        label.attributedText = NSAttributedString(string: text, attributes: [
            .font: font,
            // Softened white — still white, just not glaring (and not grey).
            .strokeColor: UIColor.white.withAlphaComponent(0.5),
            .foregroundColor: UIColor.clear,
            .strokeWidth: strokeWidth,
        ])
    }
}
