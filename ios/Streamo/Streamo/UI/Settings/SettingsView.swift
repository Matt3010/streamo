import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct SettingsView: View {
    @Bindable private var settings = AppSettings.shared
    @Environment(Library.self) private var library
    @State private var backupFile: BackupFile?
    @State private var showImporter = false
    @State private var pendingRestoreData: Data?
    @State private var confirmRestoreStep1 = false
    @State private var confirmRestoreStep2 = false
    @State private var restoreError: String?

    var body: some View {
        Form {
            appearanceSection
            playbackSection
            dataSection
            aboutSection
        }
        .navigationTitle("Impostazioni")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $backupFile) { file in
            ShareSheet(items: [file.url])
        }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.json]) { result in
            handleImport(result)
        }
        .confirmationDialog("Ripristinare dal backup?", isPresented: $confirmRestoreStep1, titleVisibility: .visible) {
            Button("Continua", role: .destructive) { confirmRestoreStep2 = true }
            Button("Annulla", role: .cancel) { pendingRestoreData = nil }
        } message: {
            Text("Tutti i dati attuali (lista, progressi, download) verranno sostituiti con quelli del backup. L'operazione non è reversibile.")
        }
        .confirmationDialog("Confermi il ripristino?", isPresented: $confirmRestoreStep2, titleVisibility: .visible) {
            Button("Ripristina", role: .destructive) { performRestore() }
            Button("Annulla", role: .cancel) { pendingRestoreData = nil }
        } message: {
            Text("Sei sicuro? I dati attuali andranno persi definitivamente.")
        }
        .alert("Backup non valido", isPresented: Binding(
            get: { restoreError != nil },
            set: { if !$0 { restoreError = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(restoreError ?? "")
        }
    }

    private var appearanceSection: some View {
        Section {
            Toggle("Mostra titolo, anno e voto", isOn: $settings.showCardInfo)
        } header: {
            Text("Aspetto")
        } footer: {
            Text("Le copertine in \"Continua a guardare\" mantengono sempre titolo e avanzamento.")
        }
    }

    private var playbackSection: some View {
        Section {
            Toggle("Riproduci episodio successivo", isOn: $settings.autoplayNext)
            Picker("Qualità streaming", selection: $settings.streamingMaxHeight) {
                Text("Auto").tag(0)
                Text("1080p").tag(1080)
                Text("720p").tag(720)
                Text("480p").tag(480)
            }
            Picker("Qualità download", selection: $settings.downloadMaxHeight) {
                Text("1080p").tag(1080)
                Text("720p").tag(720)
                Text("480p").tag(480)
            }
            Toggle("Elimina download dopo la visione", isOn: $settings.autoDeleteWatchedDownloads)
        } header: {
            Text("Riproduzione e download")
        } footer: {
            Text("Streaming su Auto adatta la qualità alla connessione. I download salvano la qualità massima disponibile fino al valore scelto.")
        }
    }

    private var dataSection: some View {
        Section {
            Button("Crea backup") { createBackup() }
            Button("Ripristina da backup") { showImporter = true }
                .foregroundStyle(.red)
            NavigationLink("Avanzate") {
                AdvancedSettingsView()
            }
        } header: {
            Text("Dati e sistema")
        } footer: {
            Text("Il backup include lista, progressi e impostazioni. Il ripristino sostituisce i dati attuali; i file video scaricati non sono inclusi.")
        }
    }

    private var aboutSection: some View {
        Section {
            LabeledContent("Versione", value: appVersion)
        } footer: {
            Text("Project Obsidian — app personale. Lo streaming usa provider di terze parti; la legalità dipende dalle tue leggi locali.")
        }
    }

    private func createBackup() {
        guard let data = library.exportBackup() else {
            ToastCenter.shared.show("Backup non riuscito")
            return
        }
        let stamp = ISO8601DateFormatter().string(from: .now)
            .replacingOccurrences(of: ":", with: "-")
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("project-obsidian-backup-\(stamp).json")
        do {
            try data.write(to: url, options: .atomic)
            backupFile = BackupFile(url: url)
        } catch {
            ToastCenter.shared.show("Backup non riuscito")
        }
    }

    private func handleImport(_ result: Result<URL, Error>) {
        guard case .success(let url) = result else { return }
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
            restoreError = "Il file non sembra un backup di Project Obsidian valido."
        }
    }

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
    }
}

private struct BackupFile: Identifiable {
    let url: URL
    var id: String { url.lastPathComponent }
}

private struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
