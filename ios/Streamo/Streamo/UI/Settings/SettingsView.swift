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
    @State private var lanCandidates: [LANAddress.Candidate] = []
    @State private var lanPort: UInt16 = 0
    @State private var showLanPassword = false
    @State private var lanPermissionDenied = false

    var body: some View {
        Form {
            Section("Catalogo (TMDB)") {
                TextField("Chiave API TMDB", text: $settings.tmdbApiKey)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.system(.body, design: .monospaced))
                if !settings.hasTmdbKey {
                    Text("Senza chiave il catalogo non si carica.")
                        .font(.footnote)
                        .foregroundStyle(.red)
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
                            Circle()
                                .fill(color)
                                .frame(width: 30, height: 30)
                                .overlay(
                                    Circle().strokeBorder(
                                        .white.opacity(isCurrentAccent(color) ? 0.95 : 0.15),
                                        lineWidth: isCurrentAccent(color) ? 3 : 1
                                    )
                                )
                        }
                        .buttonStyle(.plain)
                    }
                    Spacer()
                }
                .padding(.vertical, 2)
                ColorPicker(
                    "Colore personalizzato",
                    selection: Binding(get: { Theme.red }, set: { Theme.setAccent($0) }),
                    supportsOpacity: false
                )
                Button("Ripristina rosso Streamo") {
                    Theme.setAccent(
                        Color(
                            red: AppSettings.defaultAccent.r,
                            green: AppSettings.defaultAccent.g,
                            blue: AppSettings.defaultAccent.b
                        )
                    )
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
                Picker("Streaming", selection: $settings.streamingMaxHeight) {
                    Text("Auto").tag(0)
                    Text("1080p").tag(1080)
                    Text("720p").tag(720)
                    Text("480p").tag(480)
                }
                Picker("Download", selection: $settings.downloadMaxHeight) {
                    Text("1080p").tag(1080)
                    Text("720p").tag(720)
                    Text("480p").tag(480)
                }
            } header: {
                Text("Qualità")
            } footer: {
                Text("Streaming: \"Auto\" adatta la qualità alla connessione. Con il proxy WARP attivo la risoluzione scelta viene forzata (anche in AirPlay); senza WARP fa solo da limite massimo (la qualità può scendere). Download: ogni titolo viene salvato alla risoluzione scelta (la più alta disponibile fino a quel valore).")
            }

            Section {
                Toggle("Mostra titolo, anno e voto", isOn: $settings.showCardInfo)
            } header: {
                Text("Copertine")
            } footer: {
                Text("Quando disattivato le card mostrano solo la copertina. \"Continua a guardare\" mantiene comunque titolo e avanzamento.")
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

            Section("Avanzate") {
                NavigationLink("Apri impostazioni avanzate") {
                    AdvancedSettingsView()
                }
            }

            lanShareSection

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
        .navigationBarTitleDisplayMode(.inline)
        .task { refreshLANInfo() }
        .task(id: settings.lanShareEnabled) {
            guard settings.lanShareEnabled else { lanPermissionDenied = false; return }
            lanPermissionDenied = await LocalNetworkProbe.isDenied()
        }
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
            Text("Tutti i dati attuali (lista, cronologia, progressi, download) verranno sostituiti con quelli del backup. L'operazione non è reversibile.")
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

    @ViewBuilder
    private var lanShareSection: some View {
        Section {
            HStack {
                Group {
                    if showLanPassword {
                        TextField("Password di accesso", text: $settings.lanPassword)
                    } else {
                        SecureField("Password di accesso", text: $settings.lanPassword)
                    }
                }
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .onChange(of: settings.lanPassword) { _, newValue in
                    if newValue.isEmpty {
                        LANShareCoordinator.setEnabled(false)   // can't share without a password
                    } else if settings.lanShareEnabled {
                        LocalHLSServer.shared.setLANConfig(enabled: true, token: settings.lanToken, password: newValue)
                    }
                }
                Button { showLanPassword.toggle() } label: {
                    Image(systemName: showLanPassword ? "eye.slash" : "eye")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(showLanPassword ? "Nascondi password" : "Mostra password")
            }
            Toggle("Permetti accesso LAN", isOn: Binding(
                get: { settings.lanShareEnabled },
                set: { on in
                    LANShareCoordinator.setEnabled(on)
                    if on { refreshLANInfo() }
                }
            ))
            .disabled(settings.lanPassword.isEmpty)
            if settings.lanShareEnabled {
                if lanPermissionDenied {
                    VStack(alignment: .leading, spacing: 6) {
                        Label("Permesso \"Rete locale\" negato", systemImage: "exclamationmark.triangle.fill")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.orange)
                        Text("Senza questo permesso i dispositivi sul Wi‑Fi non possono raggiungere i tuoi download (l'hotspot funziona comunque). Attivalo per Streamo nelle Impostazioni di sistema.")
                            .font(.footnote).foregroundStyle(.secondary)
                        Button("Apri Impostazioni") {
                            if let url = URL(string: UIApplication.openSettingsURLString) {
                                UIApplication.shared.open(url)
                            }
                        }
                        .font(.footnote.weight(.semibold))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 4)
                }
                Picker("Spegnimento automatico", selection: $settings.lanShareAutoOffMinutes) {
                    Text("Mai").tag(0)
                    Text("15 minuti").tag(15)
                    Text("30 minuti").tag(30)
                    Text("1 ora").tag(60)
                    Text("2 ore").tag(120)
                    Text("4 ore").tag(240)
                }
                .onChange(of: settings.lanShareAutoOffMinutes) { _, _ in
                    LANShareCoordinator.applyAutoOff()
                }
                if let deadline = settings.lanShareDeadline, settings.lanShareAutoOffMinutes > 0 {
                    LabeledContent("Si spegne", value: Self.relativeShutoff(deadline))
                        .foregroundStyle(.secondary)
                }
                if let candidate = lanCandidates.first, lanPort != 0 {
                    let url = "http://\(candidate.address):\(lanPort)/\(settings.lanToken)/"
                    LabeledContent("Rete", value: candidate.interfaceLabel)
                    LabeledContent("IP del telefono", value: candidate.address)
                    LabeledContent("Porta", value: String(lanPort))
                    VStack(spacing: 10) {
                        QRCodeView(payload: url, size: 200)
                        Text(url)
                            .font(.system(.footnote, design: .monospaced))
                            .textSelection(.enabled)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                    Button("Copia URL") {
                        UIPasteboard.general.string = url
                        ToastCenter.shared.show("URL copiato")
                    }
                    Button("Genera nuovo token") {
                        settings.rotateLANToken()
                        LocalHLSServer.shared.setLANConfig(enabled: true, token: settings.lanToken, password: settings.lanPassword)
                        ToastCenter.shared.show("Token aggiornato — i vecchi link non funzioneranno più")
                    }
                    .foregroundStyle(.red)
                    if lanCandidates.count > 1 {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Indirizzi alternativi")
                                .font(.footnote.weight(.semibold))
                            ForEach(Array(lanCandidates.dropFirst())) { alt in
                                Text("\(alt.interfaceLabel): \(alt.address)")
                                    .font(.system(.caption, design: .monospaced))
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 4)
                    }
                } else {
                    Text("Collega il telefono a una rete locale o attiva l'Hotspot personale per ottenere un indirizzo LAN.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Button("Riprova") { refreshLANInfo() }
                }
            }
        } header: {
            Text("Condivisione LAN")
        } footer: {
            Text("Imposta una password: ti verrà chiesta dal browser (o da VLC) per accedere ai file — l'accesso LAN non si attiva senza. La password non è inclusa nel backup. Quando attiva, i download sono accessibili dal PC sulla stessa Wi‑Fi aprendo il link in VLC o nel browser. Il server resta raggiungibile anche con telefono bloccato grazie a un audio silenzioso in background — vedrai l'indicatore audio nel Centro di Controllo e ci sarà un piccolo consumo di batteria extra. Lo spegnimento automatico serve a evitare di lasciarla attiva tutta la notte. Lascia spento fuori casa per non esporre i file su reti sconosciute.")
        }
    }

    private static let lanShutoffFormatter: DateComponentsFormatter = {
        let formatter = DateComponentsFormatter()
        formatter.allowedUnits = [.hour, .minute]
        formatter.unitsStyle = .full
        formatter.zeroFormattingBehavior = .dropAll
        return formatter
    }()

    private static func relativeShutoff(_ date: Date) -> String {
        let interval = date.timeIntervalSinceNow
        guard interval > 0 else { return "Adesso" }
        guard let value = lanShutoffFormatter.string(from: interval) else { return "—" }
        return "tra \(value)"
    }

    private func refreshLANInfo() {
        lanCandidates = LANAddress.shareableIPv4Candidates()
        lanPort = LocalHLSServer.shared.waitForReady(timeout: 0.5)
    }

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

    private func isCurrentAccent(_ color: Color) -> Bool {
        let resolved = color.resolve(in: EnvironmentValues())
        return abs(Double(resolved.red) - settings.accentR) < 0.02
            && abs(Double(resolved.green) - settings.accentG) < 0.02
            && abs(Double(resolved.blue) - settings.accentB) < 0.02
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
