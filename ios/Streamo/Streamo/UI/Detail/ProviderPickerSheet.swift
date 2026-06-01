import SwiftUI

/// Lets the user pick the correct streamingcommunity version when the automatic
/// match failed or is ambiguous. Port of the web provider picker (poster +
/// title + year + "attuale" marker, refresh action).
struct ProviderPickerSheet: View {
    let candidates: [ProviderCandidate]
    let currentId: Int?
    var onChoose: (ProviderCandidate) -> Void
    var onRefresh: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var busy = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(candidates) { c in
                        CandidateRow(candidate: c, isCurrent: c.providerTitleId == currentId) {
                            busy = true
                            onChoose(c)
                            dismiss()
                        }
                        .disabled(busy)
                    }
                } header: {
                    Text("Quale di questi è il titolo giusto?")
                } footer: {
                    Text("La scelta resta salvata e non verrà più ricalcolata automaticamente.")
                }
            }
            .navigationTitle("Scegli la versione")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Chiudi") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { onRefresh() } label: { Label("Aggiorna", systemImage: "arrow.clockwise") }
                        .disabled(busy)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

private struct CandidateRow: View {
    let candidate: ProviderCandidate
    let isCurrent: Bool
    let onTap: () -> Void

    @State private var poster: String?

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                thumb
                VStack(alignment: .leading, spacing: 2) {
                    Text(candidate.title).font(.subheadline).lineLimit(2)
                    if let y = candidate.year { Text(String(y)).font(.caption).foregroundStyle(.secondary) }
                }
                Spacer()
                if isCurrent {
                    Label("attuale", systemImage: "checkmark.circle.fill")
                        .labelStyle(.titleAndIcon).font(.caption.weight(.semibold)).foregroundStyle(Theme.red)
                }
            }
        }
        .task {
            guard poster == nil else { return }
            if let p = candidate.posterUrl {
                poster = p
            } else {
                poster = (try? await TMDBClient.shared.searchMulti(candidate.title))?.first?.posterPath
            }
        }
    }

    @ViewBuilder
    private var thumb: some View {
        Group {
            if let url = TmdbImage.url(poster, .w92) {
                PosterImage(url: url, placeholderSystemImage: "film", contentMode: .fill)
            } else {
                ZStack { Color(.secondarySystemBackground); Image(systemName: "film").foregroundStyle(.secondary) }
            }
        }
        .frame(width: 40, height: 60)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}
