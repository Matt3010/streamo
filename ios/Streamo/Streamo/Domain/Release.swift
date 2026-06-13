import Foundation

/// Release / upcoming copy — port of the web `media-release.util.ts` +
/// `release-format.ts` (getWatchlistReleaseMeta). Produces the Italian
/// "Esce il …", "Nuovo ep. …", "Prossima stagione …" strings used on cards
/// (`nextReleaseText`) and the detail page release line.
enum Release {
    // MARK: Date helpers

    private static var calendar: Calendar {
        var c = Calendar(identifier: .gregorian); c.timeZone = .current; return c
    }

    static func parseDate(_ s: String?) -> Date? {
        guard let s, s.count >= 10 else { return nil }
        let p = s.prefix(10).split(separator: "-")
        guard p.count == 3, let y = Int(p[0]), let m = Int(p[1]), let d = Int(p[2]) else { return nil }
        return calendar.date(from: DateComponents(year: y, month: m, day: d))
    }

    static func isFuture(_ d: Date) -> Bool {
        calendar.startOfDay(for: d) > calendar.startOfDay(for: Date())
    }

    private static let longFmt: DateFormatter = {
        let f = DateFormatter(); f.locale = Locale(identifier: "it_IT"); f.setLocalizedDateFormatFromTemplate("d MMMM yyyy"); return f
    }()
    private static let shortFmt: DateFormatter = {
        let f = DateFormatter(); f.locale = Locale(identifier: "it_IT"); f.setLocalizedDateFormatFromTemplate("d MMM"); return f
    }()

    static func longDate(_ d: Date) -> String { longFmt.string(from: d) }
    static func shortDate(_ d: Date) -> String { shortFmt.string(from: d) }

    // MARK: Public API

    /// Port of getWatchlistReleaseMeta.
    static func watchlistMeta(_ item: TmdbItem, _ type: MediaType) -> (isUpcoming: Bool, text: String?) {
        let titleDate = type == .movie ? item.releaseDate : item.firstAirDate
        if let d = parseDate(titleDate), isFuture(d) {
            return (true, type == .movie ? "Esce il \(longDate(d))" : "Dal \(longDate(d))")
        }
        if type == .tv, let d = parseDate(item.nextEpisodeToAir?.airDate), isFuture(d) {
            return (false, "Nuovo ep. \(shortDate(d))")
        }
        return (false, nil)
    }

    static func isUpcoming(_ item: TmdbItem, _ type: MediaType) -> Bool {
        watchlistMeta(item, type).isUpcoming
    }


    /// Compact line for cards (`nextReleaseText`). Port of getCompactReleaseStatusText.
    static func compactStatus(_ item: TmdbItem, _ type: MediaType) -> String? {
        if let t = watchlistMeta(item, type).text { return t }
        guard type == .tv, let next = findNextSeason(item) else { return nil }
        return "Stagione \(next.season) il \(shortDate(next.date))"
    }

    /// Full sentence for the detail page. Port of getFullReleaseStatusText.
    static func fullStatus(_ item: TmdbItem, _ type: MediaType) -> String {
        if type == .tv, let d = parseDate(item.firstAirDate), isFuture(d) {
            return "Nuova serie dal \(longDate(d))."
        }
        if type == .movie {
            if let d = parseDate(item.releaseDate), isFuture(d) { return "Esce il \(longDate(d))." }
            return ""
        }
        if let nea = item.nextEpisodeToAir, let d = parseDate(nea.airDate), isFuture(d) {
            let s = nea.seasonNumber.map(String.init) ?? "?"
            let e = nea.episodeNumber.map(String.init) ?? "?"
            return "Prossimo episodio: S\(s) E\(e) in uscita il \(longDate(d))."
        }
        if let next = findNextSeason(item) {
            return "Prossima stagione: Stagione \(next.season) in uscita il \(longDate(next.date))."
        }
        if item.status == "Ended" || item.status == "Canceled" { return "Serie conclusa." }
        return ""
    }

    private static func findNextSeason(_ item: TmdbItem) -> (season: Int, date: Date)? {
        let lastSeason = TVLogic.effectiveLastEpisode(item)?.season ?? 0
        return (item.seasons ?? [])
            .filter { $0.seasonNumber > 0 }
            .compactMap { s -> (season: Int, date: Date)? in
                guard let d = parseDate(s.airDate), s.seasonNumber > lastSeason else { return nil }
                return (s.seasonNumber, d)
            }
            .sorted { $0.date < $1.date }
            .first { isFuture($0.date) }
    }
}
