import SwiftUI

struct HistoryView: View {
    @Environment(Library.self) private var library
    @AppStorage("historyTypeFilter") private var typeFilterRaw = "all"

    private let columns = [GridItem(.adaptive(minimum: 140), spacing: 14)]

    private enum TypeFilter: String { case all, tv, movie }
    private var typeFilter: TypeFilter { TypeFilter(rawValue: typeFilterRaw) ?? .all }

    private struct Section: Identifiable { let key: String; let title: String; let summary: String; let items: [HistoryEntry]; var id: String { key } }

    var body: some View {
        let _ = library.version
        let all = library.history()
        let items = typeFilter == .all ? all : all.filter { $0.mediaTypeRaw == typeFilter.rawValue }
        // The newest history row per title — only it shows a "Riprendi da S/E" hint.
        let latestKeys = latestEntryKeys(items)

        ScrollView {
            if all.isEmpty {
                ContentUnavailableView("Nessuna cronologia", systemImage: "clock.arrow.circlepath",
                                       description: Text("Quello che guardi compare qui."))
                    .padding(.top, 80)
            } else {
                VStack(alignment: .leading, spacing: 18) {
                    watchTimeCard

                    FlowLayout(spacing: 8) {
                        typeChip("Tutti", .all)
                        typeChip("TV", .tv)
                        typeChip("Film", .movie)
                    }

                    if items.isEmpty {
                        ContentUnavailableView("Niente in questa categoria",
                                               systemImage: "clock.arrow.circlepath",
                                               description: Text("Cambia filtro per vedere altri titoli."))
                            .padding(.top, 40)
                    } else {
                        ForEach(sections(items)) { section in
                            sectionView(section, latestKeys: latestKeys)
                        }
                    }
                }
                .padding()
            }
        }
        .navigationTitle("Cronologia")
        .refreshable { try? await Task.sleep(for: .milliseconds(250)) }
    }

    // MARK: - Watch time counter (port of formatWatchTimeCounter)

    /// Full-width glass bar with the total watch time, at the top of the page.
    private var watchTimeCard: some View {
        HStack(spacing: 10) {
            Image(systemName: "hourglass")
                .font(.subheadline.weight(.bold)).foregroundStyle(Theme.red)
            Text("Tempo guardato")
                .font(.subheadline).foregroundStyle(.secondary)
            Spacer()
            Text(Format.watchTime(library.totalWatchSeconds()))
                .font(.headline.monospacedDigit()).foregroundStyle(.primary)
        }
        .padding(.horizontal, 18).padding(.vertical, 14)
        .frame(maxWidth: .infinity)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(.white.opacity(0.14)))
        .shadow(color: .black.opacity(0.25), radius: 10, y: 4)
    }

    // MARK: - Sections

    @ViewBuilder
    private func typeChip(_ label: String, _ value: TypeFilter) -> some View {
        FilterChip(label: label, selected: typeFilter == value) { typeFilterRaw = value.rawValue }
    }

    /// Coordinate key of the newest history row for each title (web's
    /// `latestEntryByTitle`). Items are already newest-first.
    private func latestEntryKeys(_ items: [HistoryEntry]) -> Set<String> {
        var seenTitles = Set<String>()
        var latest = Set<String>()
        for e in items {
            let title = "\(e.mediaTypeRaw)-\(e.tmdbId)"
            if seenTitles.insert(title).inserted {
                latest.insert("\(title)-\(e.season)-\(e.episode)")
            }
        }
        return latest
    }

    /// History card enriched with the saved progress (bar + %) plus the red
    /// status line — "Completato" / "Visti N min" (port of the web history row).
    private func historyCard(_ entry: HistoryEntry) -> CardItem {
        var card = CardItem(history: entry)
        if let p = library.progress(entry.tmdbId, entry.mediaType, season: entry.season, episode: entry.episode) {
            card.position = p.position
            card.duration = p.duration
            let completed = p.duration > 0 && p.position >= p.duration * TVLogic.watchedThreshold
            card.watchStatus = completed ? "Completato" : Format.viewedMinutes(p.position)
        }
        return card
    }

    /// True for a completed TV episode that is the latest history row for its
    /// title — it gets the "Riprendi da S/E" grey line.
    private func showsResumeHint(_ entry: HistoryEntry, _ latestKeys: Set<String>) -> Bool {
        guard entry.mediaType == .tv,
              latestKeys.contains("\(entry.mediaTypeRaw)-\(entry.tmdbId)-\(entry.season)-\(entry.episode)"),
              let p = library.progress(entry.tmdbId, entry.mediaType, season: entry.season, episode: entry.episode)
        else { return false }
        return p.duration > 0 && p.position >= p.duration * TVLogic.watchedThreshold
    }

    @ViewBuilder
    private func sectionView(_ section: Section, latestKeys: Set<String>) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(section.title).font(.title3.bold())
                if !section.summary.isEmpty {
                    Text(section.summary).font(.caption).foregroundStyle(.secondary)
                }
            }
            LazyVGrid(columns: columns, spacing: 18) {
                ForEach(section.items, id: \.persistentModelID) { entry in
                    NavigationLink(value: MediaRef(tmdbId: entry.tmdbId, mediaType: entry.mediaType,
                                                   resumeSeason: entry.season, resumeEpisode: entry.episode)) {
                        MediaCard(card: historyCard(entry), showProgress: true, showWatchStatus: false,
                                  library: library, wantsResumeHint: showsResumeHint(entry, latestKeys))
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button(role: .destructive) {
                            library.removeHistory(entry)
                            ToastCenter.shared.show("Rimosso dalla cronologia")
                        } label: { Label("Rimuovi dalla cronologia", systemImage: "trash") }
                    }
                }
            }
        }
    }

    /// Group newest-first entries into time buckets (port of buildHistorySections).
    private func sections(_ entries: [HistoryEntry]) -> [Section] {
        var order: [String] = []
        var grouped: [String: [HistoryEntry]] = [:]
        for e in entries {
            let key = sectionKey(e.watchedAt)
            if grouped[key] == nil { grouped[key] = []; order.append(key) }
            grouped[key]?.append(e)
        }
        return order.map { key in
            let items = grouped[key] ?? []
            return Section(key: key, title: sectionTitle(key), summary: summary(items), items: items)
        }
    }

    private func sectionKey(_ date: Date) -> String {
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())
        let d = cal.startOfDay(for: date)
        let diff = cal.dateComponents([.day], from: d, to: today).day ?? 0
        if diff <= 0 { return "today" }
        if diff == 1 { return "yesterday" }
        if diff < 7 { return "week" }
        let now = Date()
        if cal.component(.year, from: now) == cal.component(.year, from: date),
           cal.component(.month, from: now) == cal.component(.month, from: date) { return "month" }
        return "older:\(cal.component(.year, from: date))-\(cal.component(.month, from: date))"
    }

    private func sectionTitle(_ key: String) -> String {
        switch key {
        case "today": return "Oggi"
        case "yesterday": return "Ieri"
        case "week": return "Questa settimana"
        case "month": return "Questo mese"
        default: return "Prima"
        }
    }

    private func summary(_ items: [HistoryEntry]) -> String {
        // Count only meaningful rows: episodes started >10s or completed; films
        // only when completed (port of the web historySectionSummary).
        var episodes = 0, movies = 0
        for e in items {
            let p = library.progress(e.tmdbId, e.mediaType, season: e.season, episode: e.episode)
            let pos = p?.position ?? 0, dur = p?.duration ?? 0
            let completed = dur > 0 && pos >= dur * TVLogic.watchedThreshold
            if e.mediaType == .tv {
                if completed || pos > 10 { episodes += 1 }
            } else if completed {
                movies += 1
            }
        }
        var parts: [String] = []
        if episodes > 0 { parts.append(episodes == 1 ? "1 episodio visto" : "\(episodes) episodi visti") }
        if movies > 0 { parts.append(movies == 1 ? "1 film completato" : "\(movies) film completati") }
        return parts.joined(separator: " • ")
    }
}
