import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct SettingsView: View {
    @Bindable private var settings = AppSettings.shared
    @Environment(Library.self) private var library
    @State private var confirmRecalc = false
    @State private var backupFile: BackupFile?
    @State private var showImporter = false
    @State private var pendingRestoreData: Data?
    @State private var confirmRestoreStep1 = false
    @State private var confirmRestoreStep2 = false
    @State private var restoreError: String?

    var body: some View {
        Form {
            Section("Catalogo (TMDB)") {
                TextField("Chiave API TMDB", text: $settings.tmdbApiKey)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.system(.body, design: .monospaced))
                if !settings.hasTmdbKey {
                    Text("Senza chiave il catalogo non si carica.")
                        .font(.footnote).foregroundStyle(.red)
                }
                Button("Ripristina chiave predefinita") {
                    settings.tmdbApiKey = AppSettings.defaultTmdbApiKey
                }
                .disabled(settings.tmdbApiKey == AppSettings.defaultTmdbApiKey)
            }

            Section {
                HStack(spacing: 12) {
                    ForEach(Array(Theme.accentPresets.enumerated()), id: \.offset) { _, color in
                        Button { Theme.setAccent(color) } label: {
                            Circle().fill(color).frame(width: 30, height: 30)
                                .overlay(Circle().strokeBorder(.white.opacity(isCurrentAccent(color) ? 0.95 : 0.15),
                                                               lineWidth: isCurrentAccent(color) ? 3 : 1))
                        }
                        .buttonStyle(.plain)
                    }
                    Spacer()
                }
                .padding(.vertical, 2)
                ColorPicker("Colore personalizzato",
                            selection: Binding(get: { Theme.red }, set: { Theme.setAccent($0) }),
                            supportsOpacity: false)
                Button("Ripristina rosso Streamo") {
                    Theme.setAccent(Color(red: AppSettings.defaultAccent.r,
                                          green: AppSettings.defaultAccent.g,
                                          blue: AppSettings.defaultAccent.b))
                }
            } header: {
                Text("Colore dell'app")
            } footer: {
                Text("L'accent tinge pulsanti, barre di avanzamento, badge e lo sfondo. Si applica subito.")
            }

            Section("Riproduzione") {
                Toggle("Riproduci episodio successivo", isOn: $settings.autoplayNext)
            }

            Section {
                Toggle("Elimina dopo la visione", isOn: $settings.autoDeleteWatchedDownloads)
            } header: {
                Text("Download")
            } footer: {
                Text("Cancella automaticamente un download quando lo hai finito di guardare (≥90%), per liberare spazio.")
            }

            Section {
                Toggle("Folder nella mia lista", isOn: $settings.foldersEnabled)
            } header: {
                Text("Organizzazione")
            } footer: {
                Text("Raggruppa film e serie in cartelle nella tua lista. Le cartelle si assegnano dalla pagina \"La mia lista\".")
            }

            Section {
                Button("Ricalcola libreria") { confirmRecalc = true }
            } header: {
                Text("Manutenzione")
            } footer: {
                Text("Rimuove i progressi rimasti appesi dei titoli che hai tolto dalla cronologia e dalla lista, e aggiorna le statistiche e \"Continua a guardare\".")
            }

            Section {
                Button("Crea backup") { createBackup() }
                Button("Ripristina da backup") { showImporter = true }
                    .foregroundStyle(.red)
            } header: {
                Text("Backup")
            } footer: {
                Text("Il backup esporta lista, cronologia, progressi, segnalibri e impostazioni in un file .json che puoi salvare dove vuoi. Il ripristino sostituisce TUTTI i dati attuali. I file dei download non sono inclusi: andranno riscaricati.")
            }

            Section {
                LabeledContent("Versione", value: appVersion)
            } footer: {
                Text("Streamo — app personale. Lo streaming usa provider di terze parti; la legalità dipende dalle tue leggi locali.")
            }
        }
        .navigationTitle("Impostazioni")
        .confirmationDialog("Ricalcolare la libreria?", isPresented: $confirmRecalc, titleVisibility: .visible) {
            Button("Ricalcola", role: .destructive) {
                let n = library.recalculate()
                ToastCenter.shared.show(n == 0 ? "Libreria già pulita" :
                    (n == 1 ? "Rimosso 1 titolo orfano" : "Rimossi \(n) titoli orfani"))
            }
            Button("Annulla", role: .cancel) {}
        } message: {
            Text("Elimina i progressi dei titoli non più in cronologia né in lista. La cronologia e la lista non vengono toccate.")
        }
        .sheet(item: $backupFile) { file in
            ShareSheet(items: [file.url])
        }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.json]) { result in
            handleImport(result)
        }
        // First confirmation: explain consequences.
        .confirmationDialog("Ripristinare dal backup?",
                            isPresented: $confirmRestoreStep1, titleVisibility: .visible) {
            Button("Continua", role: .destructive) { confirmRestoreStep2 = true }
            Button("Annulla", role: .cancel) { pendingRestoreData = nil }
        } message: {
            Text("Tutti i dati attuali (lista, cronologia, progressi, download) verranno sostituiti con quelli del backup. L'operazione non è reversibile.")
        }
        // Second confirmation: final go/no-go.
        .confirmationDialog("Confermi il ripristino?",
                            isPresented: $confirmRestoreStep2, titleVisibility: .visible) {
            Button("Ripristina", role: .destructive) { performRestore() }
            Button("Annulla", role: .cancel) { pendingRestoreData = nil }
        } message: {
            Text("Sei sicuro? I dati attuali andranno persi definitivamente.")
        }
        .alert("Backup non valido", isPresented: Binding(
            get: { restoreError != nil }, set: { if !$0 { restoreError = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(restoreError ?? "")
        }
    }

    // MARK: - Backup / Restore

    private func createBackup() {
        guard let data = library.exportBackup() else {
            ToastCenter.shared.show("Backup non riuscito")
            return
        }
        let stamp = ISO8601DateFormatter().string(from: .now)
            .replacingOccurrences(of: ":", with: "-")
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("streamo-backup-\(stamp).json")
        do {
            try data.write(to: url, options: .atomic)
            backupFile = BackupFile(url: url)
        } catch {
            ToastCenter.shared.show("Backup non riuscito")
        }
    }

    private func handleImport(_ result: Result<URL, Error>) {
        guard case .success(let url) = result else { return }
        // iOS hands back a security-scoped URL — we must claim access to read it.
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else {
            restoreError = "Impossibile leggere il file selezionato."
            return
        }
        pendingRestoreData = data
        confirmRestoreStep1 = true
    }

    private func performRestore() {
        guard let data = pendingRestoreData else { return }
        pendingRestoreData = nil
        if library.restoreBackup(from: data) {
            ToastCenter.shared.show("Libreria ripristinata")
        } else {
            restoreError = "Il file non sembra un backup di Streamo valido."
        }
    }

    /// Whether a preset matches the current accent (within a small tolerance).
    private func isCurrentAccent(_ color: Color) -> Bool {
        let c = color.resolve(in: EnvironmentValues())
        return abs(Double(c.red) - settings.accentR) < 0.02
            && abs(Double(c.green) - settings.accentG) < 0.02
            && abs(Double(c.blue) - settings.accentB) < 0.02
    }

    private var appVersion: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        return v
    }
}

/// Wraps a temporary backup file URL so the share sheet can be triggered via
/// `.sheet(item:)` (which needs an Identifiable payload).
private struct BackupFile: Identifiable {
    let url: URL
    var id: String { url.lastPathComponent }
}

/// Thin UIActivityViewController bridge: SwiftUI's `ShareLink` doesn't expose
/// `Data` cleanly as a named .json file, so we go through UIKit.
private struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
