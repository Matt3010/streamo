import Foundation
import SwiftData
import Observation
import WidgetKit

/// On-device library: watchlist / progress / history backed by SwiftData.
/// Replaces the web app's /user/* endpoints. Lives on the main actor and is
/// injected into the SwiftUI environment. `version` bumps after each mutation
/// so views observing it refresh (continue-watching, badges, …).
@MainActor
@Observable
final class Library {
    let context: ModelContext
    /// Increment to nudge observers after a write.
    private(set) var version = 0

    init(context: ModelContext) {
        self.context = context
    }

    func touch() { version &+= 1 }
    func save() {
        try? context.save()
        touch()
        Task { await updateWidgetSnapshot() }
    }

    /// Mirror the current "Continua a guardare" list into the App Group so the
    /// widget can render it. Uses the same rows as Home, so a finished TV
    /// episode can advance the widget to the next unstarted episode at 0%.
    private func updateWidgetSnapshot() async {
        let rows = await continueRows(limit: 10)
        let items = rows.map { p in
            WidgetShared.ContinueItem(
                tmdbId: p.tmdbId, mediaTypeRaw: p.mediaType.rawValue, title: p.title ?? "—",
                poster: p.poster ?? p.backdrop, season: p.season, episode: p.episode,
                percent: p.duration > 0 ? min(100, max(0, p.position / p.duration * 100)) : 0
            )
        }
        WidgetShared.saveContinue(items)
        WidgetCenter.shared.reloadTimelines(ofKind: "StreamoContinue")
    }

    // MARK: - Watchlist

    func isInWatchlist(_ tmdbId: Int, _ type: MediaType) -> Bool {
        watchlistEntry(tmdbId, type) != nil
    }

    /// Current watchlist status for a title, or nil if it isn't in the list.
    func watchlistStatus(_ tmdbId: Int, _ type: MediaType) -> WatchlistStatus? {
        watchlistEntry(tmdbId, type)?.status
    }

    private func watchlistEntry(_ tmdbId: Int, _ type: MediaType) -> WatchlistEntry? {
        let raw = type.rawValue
        var d = FetchDescriptor<WatchlistEntry>(predicate: #Predicate { $0.tmdbId == tmdbId && $0.mediaTypeRaw == raw })
        d.fetchLimit = 1
        return try? context.fetch(d).first
    }

    /// Toggle watchlist membership. Returns the new membership state.
    @discardableResult
    func toggleWatchlist(item: TmdbItem, type: MediaType) -> Bool {
        if let existing = watchlistEntry(item.id, type) {
            context.delete(existing)
            save()
            return false
        }
        context.insert(WatchlistEntry(tmdbId: item.id, mediaType: type, title: item.displayTitle, poster: item.posterPath))
        save()
        return true
    }

    func removeFromWatchlist(_ tmdbId: Int, _ type: MediaType) {
        if let e = watchlistEntry(tmdbId, type) { context.delete(e); save() }
    }

    func setWatchlistStatus(_ tmdbId: Int, _ type: MediaType, _ status: WatchlistStatus, doneAiredEpisodes: Int? = nil) {
        guard let e = watchlistEntry(tmdbId, type) else { return }
        e.status = status
        // Mirror the web PATCH: entering "done" stamps the aired baseline (when
        // provided); leaving "done" must clear it so a stale count can't mask
        // real progress as "Sei al passo".
        if status == .done {
            if let doneAiredEpisodes { e.doneAiredEpisodes = doneAiredEpisodes }
        } else {
            e.doneAiredEpisodes = 0
        }
        save()
    }

    func watchlist() -> [WatchlistEntry] {
        let d = FetchDescriptor<WatchlistEntry>(sortBy: [SortDescriptor(\.addedAt, order: .reverse)])
        return (try? context.fetch(d)) ?? []
    }

    /// The stored "aired episode count when marked done" baseline (0 if not in
    /// the watchlist or never completed) — feeds the "Sei al passo" floor.
    func doneAiredEpisodes(_ tmdbId: Int, _ type: MediaType) -> Int {
        watchlistEntry(tmdbId, type)?.doneAiredEpisodes ?? 0
    }

    func setLastKnownAired(_ tmdbId: Int, _ type: MediaType, count: Int, season: Int) {
        guard let e = watchlistEntry(tmdbId, type) else { return }
        e.lastKnownAiredEpisodes = count
        e.lastKnownAiredSeason = season
        save()
    }

    // MARK: - Progress

    func progress(_ tmdbId: Int, _ type: MediaType, season: Int, episode: Int) -> ProgressEntry? {
        let raw = type.rawValue
        var d = FetchDescriptor<ProgressEntry>(predicate: #Predicate {
            $0.tmdbId == tmdbId && $0.mediaTypeRaw == raw && $0.season == season && $0.episode == episode
        })
        d.fetchLimit = 1
        return try? context.fetch(d).first
    }

    /// Upsert a progress row (mirrors the web's progress.save).
    func saveProgress(tmdbId: Int, type: MediaType, season: Int, episode: Int,
                      position: Double, duration: Double,
                      title: String?, poster: String?, backdrop: String?) {
        if let e = progress(tmdbId, type, season: season, episode: episode) {
            e.position = position
            e.duration = duration
            e.updatedAt = .now
            e.hiddenFromContinue = false   // watching again unhides it from Continua
            if let title { e.title = title }
            if let poster { e.poster = poster }
            if let backdrop { e.backdrop = backdrop }
        } else {
            context.insert(ProgressEntry(tmdbId: tmdbId, mediaType: type, season: season, episode: episode,
                                         position: position, duration: duration, title: title, poster: poster, backdrop: backdrop))
        }
        // Watchlist lifecycle on save — port of maybeAutoCompleteWatchlist.
        // Movies need no TMDB lookup so we finish them here; series auto-flip
        // to "done" happens on-read in WatchlistEnrichment (needs the aired
        // count). Starting any title bumps "Da guardare" → "In corso".
        if let w = watchlistEntry(tmdbId, type), w.status != .done {
            if type == .movie, duration > 0, position >= duration * TVLogic.watchedThreshold {
                w.status = .done
                w.doneAiredEpisodes = 0
            } else if w.status == .todo, position > 15 {
                w.status = .inProgress
            }
        }
        save()
    }

    func removeProgress(_ tmdbId: Int, _ type: MediaType, season: Int, episode: Int) {
        if let e = progress(tmdbId, type, season: season, episode: episode) { context.delete(e); save() }
    }

    /// Library maintenance ("Ricalcola"): drop progress rows for titles no
    /// longer referenced by history OR the watchlist — leftovers from titles
    /// you removed that still linger in "Continua a guardare". Watch time is
    /// already computed live from history, so this only tidies the resume list
    /// and refreshes derived views. Returns the number of titles cleaned up.
    @discardableResult
    func recalculate() -> Int {
        let key: (String, Int) -> String = { "\($0)-\($1)" }
        let historyKeys = Set(((try? context.fetch(FetchDescriptor<HistoryEntry>())) ?? [])
            .map { key($0.mediaTypeRaw, $0.tmdbId) })
        let watchlistKeys = Set(((try? context.fetch(FetchDescriptor<WatchlistEntry>())) ?? [])
            .map { key($0.mediaTypeRaw, $0.tmdbId) })

        var removed = Set<String>()
        for p in (try? context.fetch(FetchDescriptor<ProgressEntry>())) ?? [] {
            let k = key(p.mediaTypeRaw, p.tmdbId)
            if !historyKeys.contains(k) && !watchlistKeys.contains(k) {
                context.delete(p)
                removed.insert(k)
            }
        }
        save()
        return removed.count
    }

    /// Hide a title from "Continua a guardare" without deleting its progress
    /// (so smart-resume still works). Watching it again unhides it.
    func hideFromContinue(_ tmdbId: Int, _ type: MediaType) {
        let raw = type.rawValue
        let d = FetchDescriptor<ProgressEntry>(predicate: #Predicate { $0.tmdbId == tmdbId && $0.mediaTypeRaw == raw })
        for e in (try? context.fetch(d)) ?? [] { e.hiddenFromContinue = true }
        save()
    }

    /// Delete every progress row for a series (reset "da vedere").
    func clearSeriesProgress(_ tmdbId: Int) {
        for e in seriesProgress(tmdbId) { context.delete(e) }
        save()
    }

    /// Mark an episode (and, via the resume pivot, everything before it) as
    /// watched without playing. Stores a tiny finished marker (position ==
    /// duration) so it counts as watched but never shows a progress bar or
    /// appears in "continua a guardare". Mirrors the web's manual mark.
    func markWatchedUpTo(tmdbId: Int, season: Int, episode: Int, title: String?, poster: String?) {
        saveProgress(tmdbId: tmdbId, type: .tv, season: season, episode: episode,
                     position: 1, duration: 1, title: title, poster: poster, backdrop: nil)
    }

    /// Mark a movie watched without playing.
    func markMovieWatched(tmdbId: Int, title: String?, poster: String?) {
        saveProgress(tmdbId: tmdbId, type: .movie, season: 0, episode: 0,
                     position: 1, duration: 1, title: title, poster: poster, backdrop: nil)
    }

    /// All per-episode progress rows for a series.
    func seriesProgress(_ tmdbId: Int) -> [ProgressEntry] {
        let raw = MediaType.tv.rawValue
        let d = FetchDescriptor<ProgressEntry>(predicate: #Predicate { $0.tmdbId == tmdbId && $0.mediaTypeRaw == raw })
        return (try? context.fetch(d)) ?? []
    }

    private func latestTvProgress(_ tmdbId: Int) -> ProgressEntry? {
        let raw = MediaType.tv.rawValue
        var d = FetchDescriptor<ProgressEntry>(
            predicate: #Predicate { $0.tmdbId == tmdbId && $0.mediaTypeRaw == raw },
            sortBy: [SortDescriptor(\.updatedAt, order: .reverse),
                     SortDescriptor(\.season, order: .reverse),
                     SortDescriptor(\.episode, order: .reverse)]
        )
        d.fetchLimit = 1
        return try? context.fetch(d).first
    }

    /// "Where to play next" for a TV show — port of resolveNextPlayable.
    func nextUnwatched(item: TmdbItem) -> (season: Int, episode: Int)? {
        guard let last = latestTvProgress(item.id) else { return nil }
        let ended = last.duration > 0 && last.position >= last.duration * TVLogic.watchedThreshold
        if !ended { return (last.season, last.episode) }
        return TVLogic.nextEpisode(item, season: last.season, episode: last.episode) ?? (last.season, last.episode)
    }

    /// A "Continua a guardare" display row — may be advanced past the raw
    /// progress coordinate (next episode after a finished one).
    struct ContinueRow: Identifiable {
        let tmdbId: Int
        let mediaType: MediaType
        let title: String?
        let poster: String?
        let backdrop: String?
        let season: Int
        let episode: Int
        let position: Double
        let duration: Double
        var id: String { "\(mediaType.rawValue)-\(tmdbId)" }
    }

    /// Latest progress row per title, after the web's continue filters: actually
    /// started (`position > 5`), not hidden, and not a watchlist item already
    /// marked `done`. Mirrors the WHERE + ROW_NUMBER in GET /user/progress.
    private func continueCandidates(limit: Int) -> [ProgressEntry] {
        let d = FetchDescriptor<ProgressEntry>(sortBy: [SortDescriptor(\.updatedAt, order: .reverse)])
        let rows = (try? context.fetch(d)) ?? []
        let doneKeys = Set(watchlist().filter { $0.status == .done }.map { "\($0.mediaTypeRaw)-\($0.tmdbId)" })
        var seen = Set<String>()
        var result: [ProgressEntry] = []
        for r in rows {
            let key = "\(r.mediaTypeRaw)-\(r.tmdbId)"
            guard r.position > 5, !r.hiddenFromContinue, !doneKeys.contains(key) else { continue }
            if seen.insert(key).inserted {
                result.append(r)
                if result.count >= limit { break }
            }
        }
        return result
    }

    /// Sync "latest in-flight, not finished" list — used for the widget
    /// snapshot. The Home UI uses the richer async `continueRows`.
    func continueWatching(limit: Int = 30) -> [ProgressEntry] {
        continueCandidates(limit: limit).filter {
            !($0.duration > 0 && $0.position >= $0.duration * TVLogic.watchedThreshold)
        }
    }

    /// Home "Continua a guardare" — full port of GET /user/progress: finished
    /// TV episodes advance to the next aired episode (the title drops if none
    /// aired), near-finished movies drop. Async because advancing needs the
    /// show's TMDB season layout.
    func continueRows(limit: Int = 30) async -> [ContinueRow] {
        var out: [ContinueRow] = []
        for p in continueCandidates(limit: limit) {
            let finished = p.duration > 0 && p.position >= p.duration * TVLogic.watchedThreshold
            if p.mediaType == .movie {
                if finished { continue }
                out.append(ContinueRow(tmdbId: p.tmdbId, mediaType: .movie, title: p.title, poster: p.poster,
                                       backdrop: p.backdrop, season: 0, episode: 0,
                                       position: p.position, duration: p.duration))
            } else if finished {
                guard let item = try? await TMDBClient.shared.details(id: p.tmdbId, type: .tv),
                      let next = TVLogic.nextEpisode(item, season: p.season, episode: p.episode) else { continue }
                out.append(ContinueRow(tmdbId: p.tmdbId, mediaType: .tv, title: p.title, poster: p.poster,
                                       backdrop: p.backdrop, season: next.season, episode: next.episode,
                                       position: 0, duration: 0))
            } else {
                out.append(ContinueRow(tmdbId: p.tmdbId, mediaType: .tv, title: p.title, poster: p.poster,
                                       backdrop: p.backdrop, season: p.season, episode: p.episode,
                                       position: p.position, duration: p.duration))
            }
        }
        return out
    }

    /// Number of distinct episodes watched ≥90% for a series (badge baseline).
    func watchedEpisodeCount(_ tmdbId: Int) -> Int {
        var seen = Set<String>()
        for p in seriesProgress(tmdbId) where p.duration > 0 && p.position >= p.duration * TVLogic.watchedThreshold {
            seen.insert("\(p.season)-\(p.episode)")
        }
        return seen.count
    }

    /// Total watch time — port of the web's `watchTimeSecondsSql`. Driven by
    /// HISTORY (not raw progress): sums, for each watched episode/movie, the
    /// time of its matching progress row. So removing a title from history (or
    /// never having watched it) correctly drops it from the total, instead of
    /// counting every progress row that ever existed.
    func totalWatchSeconds() -> Double {
        let progressRows = (try? context.fetch(FetchDescriptor<ProgressEntry>())) ?? []
        var byCoordinate: [String: ProgressEntry] = [:]
        for p in progressRows {
            byCoordinate["\(p.mediaTypeRaw)-\(p.tmdbId)-\(p.season)-\(p.episode)"] = p
        }
        // De-dupe by coordinate: iOS can keep one history row per day for the
        // same episode, but the web counts each coordinate once.
        let historyRows = (try? context.fetch(FetchDescriptor<HistoryEntry>())) ?? []
        var counted = Set<String>()
        return historyRows.reduce(0) { acc, h in
            let key = "\(h.mediaTypeRaw)-\(h.tmdbId)-\(h.season)-\(h.episode)"
            guard counted.insert(key).inserted, let p = byCoordinate[key] else { return acc }
            return acc + Self.watchTimeSeconds(position: p.position, duration: p.duration)
        }
    }

    /// Per-row watch time, matching the web CASE expression exactly.
    static func watchTimeSeconds(position: Double, duration: Double) -> Double {
        if duration > 0 && position >= duration * TVLogic.watchedThreshold { return duration }
        if position > 0 && duration > 0 { return min(position, duration) }
        if position > 0 { return position }
        return 0
    }

    // MARK: - History

    func saveHistory(tmdbId: Int, type: MediaType, season: Int, episode: Int, title: String?, poster: String?) {
        // De-dupe same episode within a short window so a pause+resume doesn't
        // spam rows: replace today's row for the same coordinate.
        let raw = type.rawValue
        let cal = Calendar.current
        let startOfDay = cal.startOfDay(for: .now)
        var d = FetchDescriptor<HistoryEntry>(predicate: #Predicate {
            $0.tmdbId == tmdbId && $0.mediaTypeRaw == raw && $0.season == season && $0.episode == episode && $0.watchedAt >= startOfDay
        })
        d.fetchLimit = 1
        // Snapshot the current cumulative position so the row can later show
        // how much was watched on this day (this snapshot − the previous day's).
        let prog = progress(tmdbId, type, season: season, episode: episode)
        let pos = prog?.position ?? 0
        let dur = prog?.duration ?? 0
        if let existing = try? context.fetch(d).first {
            existing.watchedAt = .now
            existing.progressSeconds = pos
            existing.durationSeconds = dur
        } else {
            context.insert(HistoryEntry(tmdbId: tmdbId, mediaType: type, season: season, episode: episode,
                                        title: title, poster: poster,
                                        progressSeconds: pos, durationSeconds: dur))
        }
        save()
    }

    func history() -> [HistoryEntry] {
        let d = FetchDescriptor<HistoryEntry>(sortBy: [SortDescriptor(\.watchedAt, order: .reverse)])
        return (try? context.fetch(d)) ?? []
    }

    func removeHistory(_ entry: HistoryEntry) {
        context.delete(entry); save()
    }

    // MARK: - Downloads (offline HLS)

    struct DownloadDraft {
        let tmdbId: Int
        let type: MediaType
        let season: Int
        let episode: Int
        let title: String?
        let poster: String?
        let backdrop: String?
        let releaseDate: String?
        let episodeTitle: String?
        let episodeOverview: String?
        let episodeStill: String?
        let episodeRuntime: Int?
        let itemJSON: String?
    }

    /// All downloads, oldest first (queue order).
    func downloads() -> [DownloadEntry] {
        let d = FetchDescriptor<DownloadEntry>(sortBy: [SortDescriptor(\.addedAt, order: .forward)])
        return (try? context.fetch(d)) ?? []
    }

    func download(_ tmdbId: Int, _ type: MediaType, season: Int, episode: Int) -> DownloadEntry? {
        let raw = type.rawValue
        var d = FetchDescriptor<DownloadEntry>(predicate: #Predicate {
            $0.tmdbId == tmdbId && $0.mediaTypeRaw == raw && $0.season == season && $0.episode == episode
        })
        d.fetchLimit = 1
        return try? context.fetch(d).first
    }

    /// Batch upsert for downloads. Existing rows keep their queue position and
    /// state; only metadata gets refreshed. Returns how many brand-new rows
    /// were inserted.
    @discardableResult
    func addDownloads(_ drafts: [DownloadDraft]) -> Int {
        guard !drafts.isEmpty else { return 0 }

        var inserted = 0
        for draft in drafts {
            if let existing = download(draft.tmdbId, draft.type, season: draft.season, episode: draft.episode) {
                if let title = draft.title { existing.title = title }
                if let poster = draft.poster { existing.poster = poster }
                if let backdrop = draft.backdrop { existing.backdrop = backdrop }
                if let releaseDate = draft.releaseDate { existing.releaseDate = releaseDate }
                if let episodeTitle = draft.episodeTitle { existing.episodeTitle = episodeTitle }
                if let episodeOverview = draft.episodeOverview { existing.episodeOverview = episodeOverview }
                if let episodeStill = draft.episodeStill { existing.episodeStill = episodeStill }
                if let episodeRuntime = draft.episodeRuntime { existing.episodeRuntime = episodeRuntime }
                if let itemJSON = draft.itemJSON { existing.itemJSON = itemJSON }
                continue
            }

            let entry = DownloadEntry(
                tmdbId: draft.tmdbId,
                mediaType: draft.type,
                season: draft.season,
                episode: draft.episode,
                title: draft.title,
                poster: draft.poster,
                backdrop: draft.backdrop,
                releaseDate: draft.releaseDate,
                episodeTitle: draft.episodeTitle,
                episodeOverview: draft.episodeOverview,
                episodeStill: draft.episodeStill,
                episodeRuntime: draft.episodeRuntime
            )
            entry.itemJSON = draft.itemJSON
            context.insert(entry)
            inserted += 1
        }

        save()
        return inserted
    }

    /// Enqueue a download (no-op if one already exists for this coordinate).
    @discardableResult
    func addDownload(tmdbId: Int, type: MediaType, season: Int, episode: Int,
                     title: String?, poster: String?, backdrop: String? = nil, releaseDate: String?,
                     episodeTitle: String? = nil, episodeOverview: String? = nil,
                     episodeStill: String? = nil, episodeRuntime: Int? = nil,
                     itemJSON: String? = nil) -> DownloadEntry {
        if let existing = download(tmdbId, type, season: season, episode: episode) {
            if let title { existing.title = title }
            if let poster { existing.poster = poster }
            if let backdrop { existing.backdrop = backdrop }
            if let releaseDate { existing.releaseDate = releaseDate }
            if let episodeTitle { existing.episodeTitle = episodeTitle }
            if let episodeOverview { existing.episodeOverview = episodeOverview }
            if let episodeStill { existing.episodeStill = episodeStill }
            if let episodeRuntime { existing.episodeRuntime = episodeRuntime }
            if let itemJSON { existing.itemJSON = itemJSON }
            save()
            return existing
        }

        let entry = DownloadEntry(
            tmdbId: tmdbId,
            mediaType: type,
            season: season,
            episode: episode,
            title: title,
            poster: poster,
            backdrop: backdrop,
            releaseDate: releaseDate,
            episodeTitle: episodeTitle,
            episodeOverview: episodeOverview,
            episodeStill: episodeStill,
            episodeRuntime: episodeRuntime
        )
        entry.itemJSON = itemJSON
        context.insert(entry)
        save()
        return entry
    }

    /// Set a download's state (clears the error unless it's the failed state).
    func setDownloadState(_ entry: DownloadEntry, _ state: DownloadState, progress: Double? = nil, error: String? = nil) {
        entry.state = state
        if let progress { entry.progress = progress }
        entry.errorMessage = (state == .failed) ? error : nil
        save()
    }

    /// Mark a download completed and record its on-disk location. We persist
    /// both a bookmark (canonical, survives sandbox UUID changes) and the
    /// relative path string as a fallback.
    func completeDownload(_ entry: DownloadEntry, localPath: String, bookmark: Data? = nil) {
        entry.state = .completed
        entry.progress = 1
        entry.localPath = localPath
        entry.localBookmark = bookmark
        entry.errorMessage = nil
        save()
    }

    /// Record whether the active run is fetching through the WARP proxy or
    /// direct. Set once per run when the source resolves, so the Downloads list
    /// can flag each title warped or direct.
    func setDownloadViaProxy(_ entry: DownloadEntry, _ viaProxy: Bool) {
        guard entry.viaProxy != viaProxy else { return }
        entry.viaProxy = viaProxy
        save()
    }

    func removeDownload(_ entry: DownloadEntry) {
        context.delete(entry)
        save()
    }

    /// The next download waiting to start (serial queue).
    func firstQueuedDownload() -> DownloadEntry? {
        downloads().first { $0.state == .queued }
    }

    // MARK: - Provider mappings (durable streamingcommunity ↔ TMDB)

    func providerMapping(_ tmdbId: Int, _ type: MediaType) -> ProviderMapping? {
        let raw = type.rawValue
        var d = FetchDescriptor<ProviderMapping>(predicate: #Predicate { $0.tmdbId == tmdbId && $0.mediaTypeRaw == raw })
        d.fetchLimit = 1
        return try? context.fetch(d).first
    }

    /// Persist the resolved/confirmed provider mapping so picks survive
    /// restarts and confirmed titles aren't re-searched.
    func saveProviderMapping(tmdbId: Int, type: MediaType, resolved: ProviderResolvedTitle?,
                             candidates: [ProviderCandidate], matchStatus: ProviderMatchStatus,
                             sourceTitle: String?, releaseYear: Int?) {
        let json = (try? JSONEncoder().encode(candidates)).flatMap { String(data: $0, encoding: .utf8) }
        if let e = providerMapping(tmdbId, type) {
            e.providerId = resolved?.id
            e.providerSlug = resolved?.slug
            e.resolvedTitle = resolved?.title
            e.matchStatusRaw = matchStatus.rawValue
            e.sourceTitle = sourceTitle
            e.releaseYear = releaseYear
            e.lastCheckedAt = .now
            e.candidatesJSON = json
        } else {
            context.insert(ProviderMapping(
                tmdbId: tmdbId, mediaType: type, providerId: resolved?.id, providerSlug: resolved?.slug,
                sourceTitle: sourceTitle, resolvedTitle: resolved?.title, matchStatusRaw: matchStatus.rawValue,
                releaseYear: releaseYear, lastCheckedAt: .now, candidatesJSON: json
            ))
        }
        save()
    }

    func decodeCandidates(_ json: String?) -> [ProviderCandidate] {
        guard let json, let data = json.data(using: .utf8) else { return [] }
        return (try? JSONDecoder().decode([ProviderCandidate].self, from: data)) ?? []
    }
}
