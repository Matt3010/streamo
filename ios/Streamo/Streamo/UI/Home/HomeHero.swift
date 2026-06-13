import SwiftUI

/// Full-bleed "what's hot right now" hero at the top of the home screen: a
/// swipeable carousel of the most trending titles, each a large key-art image
/// with the title, a red play CTA and an add-to-list button over a bottom
/// gradient. Tapping play opens the title's detail page.
///
/// Slides cross-fade (dissolve) into one another instead of sliding, so the
/// background image blends as you swipe. All images are mounted up-front and
/// toggled by opacity, which both enables the blend and avoids the pop you'd
/// get from lazily loading the next image mid-swipe.
struct HomeHero: View {
    let items: [HomeViewModel.HeroItem]
    @State private var selection = 0
    @State private var isPlaying = true
    /// 0…1 fill of the current slide's indicator; drives the auto-advance.
    @State private var progress: Double = 0

    /// Seconds each slide stays before auto-advancing.
    private let interval: Double = 40
    /// Indicator refresh rate (how often the fill ticks forward).
    private let tickStep: Double = 0.05
    private let autoTick = Timer.publish(every: 0.05, on: .main, in: .common).autoconnect()

    private var heroHeight: CGFloat {
        min(UIScreen.main.bounds.width * 1.25, 560)
    }

    var body: some View {
        // GeometryReader pins every layer to the exact hero width so the
        // caption can't size to its (wide) intrinsic text and spill past the
        // viewport.
        GeometryReader { geo in
            let width = geo.size.width
            // Local copy so the @Sendable `.visualEffect` closure captures a
            // plain value, not the main-actor-isolated `heroHeight` property.
            let panelHeight = heroHeight

            ZStack(alignment: .bottom) {
                // Artwork that fades out toward the bottom so the hero dissolves
                // into the page background — no hard dark band between it and
                // the cards below.
                ZStack {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, hero in
                        HeroImage(hero: hero)
                            .frame(width: width, height: heroHeight)
                            .clipped()
                            .opacity(index == selection ? 1 : 0)
                    }
                }
                .frame(width: width, height: heroHeight)
                .mask(
                    LinearGradient(
                        stops: [
                            .init(color: .black, location: 0),
                            .init(color: .black, location: 0.5),
                            .init(color: .clear, location: 1),
                        ],
                        startPoint: .top, endPoint: .bottom
                    )
                )

                ForEach(Array(items.enumerated()), id: \.element.id) { index, hero in
                    HeroCaption(hero: hero)
                        .frame(width: width)
                        .opacity(index == selection ? 1 : 0)
                        .allowsHitTesting(index == selection)
                }

                if items.count > 1 { controls }
            }
            .frame(width: width, height: heroHeight)
            .clipped()
            // Pin the hero to the top of the scroll view: on pull-down
            // (overscroll, minY > 0) translate it back up and scale it from the
            // top so it grows to fill the pulled gap instead of sliding down
            // and exposing a dark band. `.visualEffect` reads the `.scrollView`
            // offset reliably and never feeds back into layout.
            .visualEffect { content, proxy in
                let minY = proxy.frame(in: .scrollView).minY
                let stretch = max(0, minY)
                let scale = (panelHeight + stretch) / panelHeight
                return content
                    .scaleEffect(scale, anchor: .top)
                    .offset(y: -stretch)
            }
            .contentShape(Rectangle())
            .animation(.easeInOut(duration: 0.45), value: selection)
            .simultaneousGesture(
                DragGesture(minimumDistance: 24)
                    .onEnded { value in
                        let dx = value.translation.width
                        let dy = value.translation.height
                        guard abs(dx) > abs(dy), abs(dx) > 50 else { return }
                        step(dx < 0 ? 1 : -1)
                    }
            )
        }
        .frame(height: heroHeight)
        // Auto-advance: fill the current indicator over `interval`, then move on.
        .onReceive(autoTick) { _ in
            guard isPlaying, items.count > 1 else { return }
            progress += tickStep / interval
            if progress >= 1 {
                progress = 0
                selection = (selection + 1) % items.count
            }
        }
    }

    private func step(_ direction: Int) {
        guard !items.isEmpty else { return }
        selection = (selection + direction + items.count) % items.count
        progress = 0
    }

    /// Story-style indicators centered in the hero, with the play/pause toggle
    /// floating at the trailing edge (deliberately off the dots' centre line).
    private var controls: some View {
        ZStack {
            HStack(spacing: 7) {
                ForEach(items.indices, id: \.self) { i in
                    indicator(i)
                }
            }
            .frame(maxWidth: .infinity, alignment: .center)

            Button {
                isPlaying.toggle()
            } label: {
                Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 24, height: 24)
                    .background(.black.opacity(0.4), in: Circle())
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 16)
    }

    private func indicator(_ i: Int) -> some View {
        let selected = i == selection
        // Always a Capsule with the SAME modifier chain, so the width change
        // (7 ↔ 22) animates as a smooth collapse/expand on selection. The
        // accent fill only grows on the selected one.
        return Capsule()
            .fill(.white.opacity(selected ? 0.3 : 0.45))
            .frame(width: selected ? 22 : 7, height: 7)
            // Rounded fill (same radius as the track) that grows left→right.
            // Interpolate from the cap size (7) to full (22) so it starts as a
            // rounded cap and grows from the very first tick — never clamped
            // (which would look frozen) and never a thin vertical sliver.
            .overlay(alignment: .leading) {
                if selected {
                    Capsule().fill(Theme.red).frame(width: 7 + 15 * progress, height: 7)
                }
            }
            .clipShape(Capsule())
            .onTapGesture { selection = i; progress = 0 }
    }
}

/// The full-bleed artwork for one hero slide (backdrop preferred, poster
/// fallback).
private struct HeroImage: View {
    let hero: HomeViewModel.HeroItem

    private var imageURL: URL? {
        TmdbImage.backdropURL(hero.item.backdropPath, .w1280)
            ?? TmdbImage.posterURL(hero.item.posterPath, .w780)
    }

    var body: some View {
        PosterImage(url: imageURL, placeholderSystemImage: "film", contentMode: .fill)
    }
}

/// Category label, title and action buttons (play + add to list) for one slide.
private struct HeroCaption: View {
    let hero: HomeViewModel.HeroItem
    @Environment(Library.self) private var library

    private var title: String {
        let t = hero.item.displayTitle
        return t.isEmpty ? UIText.untitled : t
    }

    private var categoryLabel: String {
        hero.mediaType == .movie ? "Film di tendenza" : "Serie di tendenza"
    }

    var body: some View {
        // Touch `version` so this caption re-renders when the watchlist
        // changes — `isInWatchlist` fetches directly and wouldn't otherwise
        // register an @Observable dependency.
        let _ = library.version
        let inList = library.isInWatchlist(hero.item.id, hero.mediaType)
        VStack(spacing: 12) {
            Text(categoryLabel)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.white.opacity(0.85))
                .shadow(color: .black.opacity(0.5), radius: 3)

            Text(title)
                .font(.system(size: 30, weight: .heavy, design: .rounded))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.6)
                .frame(maxWidth: .infinity)
                .shadow(color: .black.opacity(0.6), radius: 6)

            HStack(spacing: 12) {
                NavigationLink(value: MediaRef(tmdbId: hero.item.id, mediaType: hero.mediaType)) {
                    Label("Riproduci", systemImage: "play.fill")
                }
                .buttonStyle(BrandButtonStyle(kind: .primary, fullWidth: false))

                Button {
                    let added = library.toggleWatchlist(item: hero.item, type: hero.mediaType)
                    ToastCenter.shared.show(added ? "Aggiunto alla lista" : "Rimosso dalla lista")
                } label: {
                    Image(systemName: inList ? "bookmark.fill" : "bookmark")
                }
                .buttonStyle(BrandButtonStyle(kind: inList ? .primary : .secondary, fullWidth: false))
                .accessibilityLabel(inList ? UIText.removeFromList : UIText.addToList)
            }
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 44)   // leave room for the page dots below
    }
}

/// Placeholder shown while the trending lists are still loading, so the layout
/// doesn't jump when the real hero appears.
struct HomeHeroSkeleton: View {
    private var heroHeight: CGFloat { min(UIScreen.main.bounds.width * 1.25, 560) }

    var body: some View {
        Rectangle()
            .fill(Color(.secondarySystemBackground))
            .frame(height: heroHeight)
            .frame(maxWidth: .infinity)
            .overlay(alignment: .bottom) {
                VStack(spacing: 12) {
                    RoundedRectangle(cornerRadius: 8).fill(.white.opacity(0.12))
                        .frame(width: 220, height: 26)
                    RoundedRectangle(cornerRadius: 12).fill(.white.opacity(0.12))
                        .frame(width: 150, height: 44)
                }
                .padding(.bottom, 56)
            }
            .redacted(reason: .placeholder)
    }
}
