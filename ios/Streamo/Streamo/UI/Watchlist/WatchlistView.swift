import SwiftUI

struct WatchlistView: View {
    @Environment(Library.self) private var library
    @State private var enrichment = WatchlistEnrichment()
    @State private var showNewFolder = false
    @State private var newFolderName = ""
    @State private var pendingMove: MediaRef?
    @State private var pendingMarkDone: WatchlistEntry?
    @State private var pendingRemove: WatchlistEntry?
    @AppStorage("watchlistExpandedFolders") private var expandedFoldersRaw = "[]"
    @AppStorage("watchlistStatusFilter") private var statusFilterRaw = "todo"
    @AppStorage("watchlistTypeFilter") private var typeFilterRaw = "all"

    /// Expanded folders, persisted across launches (web keeps these in
    /// localStorage). Backed by a JSON array string in @AppStorage.
    private var expandedFolders: Set<String> {
        get { Set((try? JSONDecoder().decode([String].self, from: Data(expandedFoldersRaw.utf8))) ?? []) }
        nonmutating set {
            let data = (try? JSONEncoder().encode(Array(newValue).sorted())) ?? Data("[]".utf8)
            expandedFoldersRaw = String(decoding: data, as: UTF8.self)
        }
    }

    private let columns = [GridItem(.adaptive(minimum: 140), spacing: 14)]

    private enum StatusFilter: String { case todo, inProgress = "in_progress", done, unreleased }
    private enum TypeFilter: String { case all, tv, movie }
    private var statusFilter: StatusFilter { StatusFilter(rawValue: statusFilterRaw) ?? .todo }
    private var typeFilter: TypeFilter { TypeFilter(rawValue: typeFilterRaw) ?? .all }

    var body: some View {
        let _ = library.version
        let all = library.watchlist()
        let filtered = applyFilters(all)

        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                filters

                if all.isEmpty {
                    empty("Lista vuota", "Aggiungi film e serie con il segnalibro.")
                } else if filtered.isEmpty {
                    empty("Nessun titolo", "Cambia filtro per vedere altri titoli.")
                } else {
                    content(filtered)
                }
            }
            .padding(.vertical, 8)
        }
        .navigationTitle("La mia lista")
        .task(id: library.version) { await enrichment.refresh(all, library: library) }
        .refreshable { await enrichment.refresh(library.watchlist(), library: library) }
        .alert("Segna come visto", isPresented: Binding(get: { pendingMarkDone != nil }, set: { if !$0 { pendingMarkDone = nil } })) {
            Button("Segna come visto") {
                if let e = pendingMarkDone {
                    // Stamp the aired baseline (like the web PATCH) so the
                    // "done" mark can later detect newly-aired episodes.
                    Task {
                        var aired = 0
                        if e.mediaType == .tv, let item = try? await TMDBClient.shared.details(id: e.tmdbId, type: .tv) {
                            aired = TVLogic.airedEpisodesCount(item)
                        }
                        library.setWatchlistStatus(e.tmdbId, e.mediaType, .done, doneAiredEpisodes: aired)
                        ToastCenter.shared.show(WatchStatus.statusToast(e.title ?? "", .done))
                    }
                }
                pendingMarkDone = nil
            }
            Button("Annulla", role: .cancel) { pendingMarkDone = nil }
        } message: {
            Text("Il titolo verrà spostato nella sezione \"Visto\".")
        }
        .confirmationDialog("Rimuovere \(pendingRemove?.title ?? "questo titolo") dalla lista?",
                            isPresented: Binding(get: { pendingRemove != nil }, set: { if !$0 { pendingRemove = nil } }),
                            titleVisibility: .visible) {
            Button("Rimuovi", role: .destructive) {
                if let e = pendingRemove {
                    library.removeFromWatchlist(e.tmdbId, e.mediaType)
                    ToastCenter.shared.show("Rimosso dalla lista")
                }
                pendingRemove = nil
            }
            Button("Annulla", role: .cancel) { pendingRemove = nil }
        }
        .alert("Nuova cartella", isPresented: $showNewFolder) {
            TextField("Nome cartella", text: $newFolderName)
            Button("Crea") {
                let name = newFolderName.trimmingCharacters(in: .whitespaces)
                if let m = pendingMove, !name.isEmpty {
                    library.setFolder(m.tmdbId, m.mediaType, name)
                    expandedFolders.insert(name)   // show the folder right away
                }
                newFolderName = ""; pendingMove = nil
            }
            Button("Annulla", role: .cancel) { newFolderName = ""; pendingMove = nil }
        }
    }

    // MARK: - Filters

    private var filters: some View {
        VStack(alignment: .leading, spacing: 10) {
            FlowLayout(spacing: 8) {
                statusChip("Da guardare", .todo)
                statusChip("In corso", .inProgress)
                statusChip("Visto", .done)
                statusChip("Non usciti", .unreleased)
            }
            FlowLayout(spacing: 8) {
                typeChip("Tutti", .all)
                typeChip("TV", .tv)
                typeChip("Film", .movie)
            }
        }
        .padding(.horizontal)
    }

    private func statusChip(_ label: String, _ value: StatusFilter) -> some View {
        FilterChip(label: label, selected: statusFilter == value) { statusFilterRaw = value.rawValue }
    }
    private func typeChip(_ label: String, _ value: TypeFilter) -> some View {
        FilterChip(label: label, selected: typeFilter == value, compact: true) { typeFilterRaw = value.rawValue }
    }

    private func applyFilters(_ items: [WatchlistEntry]) -> [WatchlistEntry] {
        items.filter { e in
            if typeFilter != .all && e.mediaTypeRaw != typeFilter.rawValue { return false }
            let up = enrichment.isUpcoming(e)
            switch statusFilter {
            case .unreleased: return up
            case .todo: return !up && e.status == .todo
            case .inProgress: return !up && e.status == .inProgress
            case .done: return !up && e.status == .done
            }
        }
    }

    // MARK: - Layout (folder cards in the grid + expandable panel)

    /// A grid slot: either a folder tile (with its members) or a loose title.
    private struct FolderSlot: Identifiable {
        enum Kind { case folder(String, [WatchlistEntry]); case item(WatchlistEntry) }
        let id: String
        let kind: Kind
        var folderName: String? { if case .folder(let n, _) = kind { return n }; return nil }
    }

    /// Folders appear inline at the position of their first member (web parity),
    /// interleaved with loose titles, preserving the addedAt-desc order.
    private func buildSlots(_ filtered: [WatchlistEntry]) -> [FolderSlot] {
        var byFolder: [String: [WatchlistEntry]] = [:]
        for e in filtered { if let f = e.folderName { byFolder[f, default: []].append(e) } }
        var emitted = Set<String>()
        var slots: [FolderSlot] = []
        for e in filtered {
            if let f = e.folderName {
                if emitted.insert(f).inserted {
                    slots.append(FolderSlot(id: "folder:\(f)", kind: .folder(f, byFolder[f] ?? [])))
                }
            } else {
                slots.append(FolderSlot(id: "item:\(e.persistentModelID)", kind: .item(e)))
            }
        }
        return slots
    }

    @ViewBuilder
    private func content(_ filtered: [WatchlistEntry]) -> some View {
        if !AppSettings.shared.foldersEnabled {
            LazyVGrid(columns: columns, spacing: 18) {
                ForEach(filtered, id: \.persistentModelID) { cell($0) }
            }
            .padding(.horizontal)
        } else {
            let slots = buildSlots(filtered)
            LazyVGrid(columns: columns, spacing: 18) {
                ForEach(slots) { slot in
                    switch slot.kind {
                    case .folder(let name, let items): folderTile(name, items: items)
                    case .item(let entry): cell(entry)
                    }
                }
            }
            .padding(.horizontal)

            // Expanded folders' panels, in their first-appearance order.
            ForEach(slots.compactMap(\.folderName).filter { expandedFolders.contains($0) }, id: \.self) { name in
                folderPanel(name, items: filtered.filter { $0.folderName == name })
            }
        }
    }

    /// Folder tile — a 2:3 card with a red glow, icon, title, meta and chevron
    /// (port of the web folder-card). Tapping toggles its panel.
    private func folderTile(_ name: String, items: [WatchlistEntry]) -> some View {
        let expanded = expandedFolders.contains(name)
        return Button {
            if expanded { expandedFolders.remove(name) } else { expandedFolders.insert(name) }
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                Image(systemName: "folder.fill")
                    .font(.system(size: 17, weight: .semibold)).foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(Theme.red.opacity(0.18), in: RoundedRectangle(cornerRadius: 12))
                Spacer(minLength: 0)
                Text(name).font(.headline).foregroundStyle(.white).lineLimit(1)
                Text(folderMeta(items)).font(.caption).foregroundStyle(.white.opacity(0.72)).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .aspectRatio(2.0/3.0, contentMode: .fit)
            .background(
                ZStack {
                    Color(.secondarySystemBackground)
                    RadialGradient(colors: [Theme.red.opacity(0.16), .clear], center: .topLeading, startRadius: 0, endRadius: 150)
                }
            )
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(alignment: .topTrailing) {
                Image(systemName: "chevron.down")
                    .font(.caption.weight(.bold)).foregroundStyle(.white.opacity(0.8))
                    .rotationEffect(.degrees(expanded ? 180 : 0)).padding(10)
            }
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(expanded ? Color.white.opacity(0.14) : Theme.red.opacity(0.42), lineWidth: 2)
            )
        }
        .buttonStyle(.plain)
    }

    /// Full-width panel listing a folder's items when expanded.
    private func folderPanel(_ name: String, items: [WatchlistEntry]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "folder.fill").foregroundStyle(Theme.red)
                Text(name).font(.headline)
                Spacer()
            }
            LazyVGrid(columns: columns, spacing: 18) {
                ForEach(items, id: \.persistentModelID) { cell($0) }
            }
        }
        .padding(12)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(.white.opacity(0.10)))
        .padding(.horizontal)
    }

    private func folderMeta(_ items: [WatchlistEntry]) -> String {
        let count = items.count
        let tv = items.filter { $0.mediaType == .tv }.count
        let movie = items.filter { $0.mediaType == .movie }.count
        let countLabel = count == 1 ? "1 titolo" : "\(count) titoli"
        let mediaLabel: String
        if tv > 0 && movie > 0 { mediaLabel = "film e serie" }
        else if tv > 0 { mediaLabel = tv == 1 ? "1 serie" : "\(tv) serie" }
        else { mediaLabel = movie == 1 ? "1 film" : "\(movie) film" }
        return "\(countLabel) • \(mediaLabel)"
    }

    // MARK: - Grid cell

    @ViewBuilder
    private func cell(_ entry: WatchlistEntry) -> some View {
        NavigationLink(value: MediaRef(tmdbId: entry.tmdbId, mediaType: entry.mediaType)) {
            MediaCard(card: CardItem(watchlist: entry), showWatchStatus: true, library: library)
        }
        .buttonStyle(.plain)
        .contextMenu { menu(for: entry) }
    }

    @ViewBuilder
    private func menu(for entry: WatchlistEntry) -> some View {
        Button { toggleStatus(entry) } label: {
            Label(statusMenuLabel(entry.status), systemImage: WatchStatus.statusIcon(entry.status))
        }
        if AppSettings.shared.foldersEnabled {
            Menu("Sposta in cartella") {
                ForEach(library.folders().filter { $0 != entry.folderName }, id: \.self) { folder in
                    Button(folder) { library.setFolder(entry.tmdbId, entry.mediaType, folder); expandedFolders.insert(folder) }
                }
                Button { pendingMove = MediaRef(tmdbId: entry.tmdbId, mediaType: entry.mediaType); showNewFolder = true } label: {
                    Label("Nuova cartella…", systemImage: "folder.badge.plus")
                }
            }
            if entry.folderName != nil {
                Button { library.setFolder(entry.tmdbId, entry.mediaType, nil) } label: {
                    Label("Togli dalla cartella", systemImage: "folder.badge.minus")
                }
            }
        }
        Button(role: .destructive) {
            pendingRemove = entry
        } label: { Label("Rimuovi dalla lista", systemImage: "trash") }
    }

    private func statusMenuLabel(_ status: WatchlistStatus) -> String {
        switch status {
        case .done: return "Segna da guardare"
        case .inProgress: return "Segna come visto"
        case .todo: return "Segna in corso"
        }
    }

    private func toggleStatus(_ entry: WatchlistEntry) {
        let t = WatchStatus.statusTransition(entry.status)
        if t.requiresConfirm {
            pendingMarkDone = entry
        } else {
            library.setWatchlistStatus(entry.tmdbId, entry.mediaType, t.next)
            ToastCenter.shared.show(WatchStatus.statusToast(entry.title ?? "", t.next))
        }
    }

    private func empty(_ title: String, _ hint: String) -> some View {
        ContentUnavailableView(title, systemImage: "bookmark", description: Text(hint))
            .padding(.top, 60)
    }
}
