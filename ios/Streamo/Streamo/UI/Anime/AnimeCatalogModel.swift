import Foundation
import Observation

/// Backs the Anime tab: AnimeUnity browse (paginated) + live search. Native
/// catalog — no TMDB. Every network call goes through `ensureAnimeSession()`
/// first so WARP stays fail-closed during browsing, not just playback.
@MainActor
@Observable
final class AnimeCatalogModel {
    private(set) var items: [AUAnime] = []
    private(set) var isLoading = false
    private(set) var loadFailed = false
    /// True while a search is active (disables browse pagination).
    private(set) var isSearching = false

    var query = "" {
        didSet {
            guard query != oldValue else { return }
            if restoringPreservedQuery {
                restoringPreservedQuery = false
                return
            }
            scheduleSearch()
        }
    }

    private var offset = 0
    private var canLoadMore = true
    private var searchTask: Task<Void, Never>?
    private var preserveQueryDuringNextNavigation = false
    private var restoringPreservedQuery = false
    private var lastNonEmptyQuery = ""
    private let pageSize = 30

    /// First browse load (no-op once populated).
    func loadInitialIfNeeded() async {
        guard items.isEmpty, !isLoading, !isSearching else { return }
        await loadBrowse(reset: true)
    }

    /// Pull the next browse page when the grid nears its end.
    func loadMoreIfNeeded(currentItem: AUAnime) async {
        guard !isSearching, canLoadMore, !isLoading else { return }
        guard let idx = items.firstIndex(of: currentItem), idx >= items.count - 6 else { return }
        await loadBrowse(reset: false)
    }

    func retry() async {
        if isSearching { scheduleSearch() } else { await loadBrowse(reset: true) }
    }

    func preserveSearchWhileOpeningResult() {
        preserveQueryDuringNextNavigation = true
    }

    private func loadBrowse(reset: Bool) async {
        if reset { offset = 0; canLoadMore = true }
        guard canLoadMore, !isLoading else { return }
        isLoading = true
        loadFailed = false
        defer { isLoading = false }

        guard await ProviderResolver.shared.ensureAnimeSession() else { loadFailed = true; return }
        do {
            let batch = try await AnimeUnityClient.shared.browse(offset: offset)
            if reset { items = batch } else { items += batch }
            offset += batch.count
            if batch.count < pageSize { canLoadMore = false }
        } catch {
            if reset { items = [] }
            loadFailed = true
        }
    }

    /// Debounced live search. Empty query reverts to browse.
    private func scheduleSearch() {
        searchTask?.cancel()
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if q.isEmpty, preserveQueryDuringNextNavigation {
            preserveQueryDuringNextNavigation = false
            if !lastNonEmptyQuery.isEmpty {
                restoringPreservedQuery = true
                query = lastNonEmptyQuery
            }
            return
        }
        if !q.isEmpty { lastNonEmptyQuery = query }
        searchTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard let self, !Task.isCancelled else { return }
            if q.isEmpty {
                self.isSearching = false
                await self.loadBrowse(reset: true)
                return
            }
            self.isSearching = true
            self.isLoading = true
            self.loadFailed = false
            defer { self.isLoading = false }
            guard await ProviderResolver.shared.ensureAnimeSession() else { self.loadFailed = true; return }
            do {
                let results = try await AnimeUnityClient.shared.search(query: q)
                guard !Task.isCancelled else { return }
                self.items = results
                self.canLoadMore = false
            } catch {
                self.items = []
                self.loadFailed = true
            }
        }
    }
}
