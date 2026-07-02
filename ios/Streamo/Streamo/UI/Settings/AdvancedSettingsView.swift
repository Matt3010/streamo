import SwiftUI

struct AdvancedSettingsView: View {
    @Bindable private var settings = AppSettings.shared
    @Environment(Library.self) private var library

    @State private var confirmRecalc = false
    @State private var warpState: WarpUIState = .idle
    @State private var warpBusy = false
    /// Whether the gomobile WARP engine is linked in this build. Checked on
    /// appear; when false the toggle is disabled with an explanation.
    @State private var warpAvailable = true

    var body: some View {
        Form {
            catalogSection
            warpSection

            Section {
                Button("Ricalcola libreria") { confirmRecalc = true }
            } header: {
                Text("Manutenzione")
            } footer: {
                Text("Rimuove i progressi rimasti appesi dei titoli che hai tolto dalla lista, e aggiorna le statistiche e \"Continua a guardare\".")
            }
        }
        .navigationTitle("Avanzate")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            warpAvailable = await WarpTunnel.shared.isAvailable
            if settings.warpRegistered, case .idle = warpState { warpState = .registered }
        }
        .confirmationDialog("Ricalcolare la libreria?", isPresented: $confirmRecalc, titleVisibility: .visible) {
            Button("Ricalcola", role: .destructive) {
                let n = library.recalculate()
                ToastCenter.shared.show(n == 0 ? "Libreria già pulita" :
                    (n == 1 ? "Rimosso 1 titolo orfano" : "Rimossi \(n) titoli orfani"))
            }
            Button("Annulla", role: .cancel) {}
        } message: {
            Text("Elimina i progressi dei titoli non più in lista. La lista non viene toccata.")
        }
    }

    private var catalogSection: some View {
        Section {
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
        } header: {
            Text("Catalogo TMDB")
        } footer: {
            Text("Usata per cercare titoli, dettagli e immagini.")
        }
    }

    @ViewBuilder
    private var warpSection: some View {
        Section {
            Toggle("WARP", isOn: $settings.warpEnabled)
                .disabled(!warpAvailable || !settings.warpRegistered)
                .onChange(of: settings.warpEnabled) { _, _ in warpState = .idle }

            if !warpAvailable {
                Text("Il motore WARP non è incluso in questa build. Compila e collega l'xcframework `WireProxyKit` (gomobile) per abilitarlo.")
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }

            if settings.warpRegistered {
                Button("Verifica egress") { Task { await verifyEgress() } }
                    .disabled(warpBusy)
                Button("Rigenera account WARP", role: .destructive) { Task { await registerWarp() } }
                    .disabled(warpBusy)
            } else {
                Button("Registra account WARP") { Task { await registerWarp() } }
                    .disabled(warpBusy)
            }

            switch warpState {
            case .idle:
                EmptyView()
            case .working(let msg):
                HStack(spacing: 10) { ProgressView(); Text(msg).foregroundStyle(.secondary) }
            case .registered:
                Text("Account WARP registrato")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.green)
            case .egress(let warp, let ip, let colo):
                VStack(alignment: .leading, spacing: 8) {
                    Text(warp ? "Egress protetto da WARP" : "WARP non attivo sull'egress")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(warp ? .green : .red)
                    if let ip { LabeledContent("IP egress", value: ip) }
                    if let colo, !colo.isEmpty { LabeledContent("Colo", value: colo) }
                }
                .font(.footnote)
            case .failure(let message):
                Text(message).font(.footnote).foregroundStyle(.red)
            }
        } header: {
            Text("WARP")
        } footer: {
            Text("Registra un account Cloudflare WARP gratuito sul dispositivo. Quando WARP è attivo, ricerca e riproduzione escono da un IP Cloudflare — il tuo IP resta nascosto a StreamingCommunity. Nessun server esterno.")
        }
    }

    @MainActor
    private func registerWarp() async {
        warpBusy = true
        warpState = .working("Registrazione WARP…")
        defer { warpBusy = false }
        do {
            _ = try await WarpAccount.shared.register()
            settings.warpRegistered = true
            warpState = .registered
            ToastCenter.shared.show("Account WARP registrato")
        } catch {
            settings.warpRegistered = await WarpAccount.shared.isRegistered
            warpState = .failure((error as? LocalizedError)?.errorDescription ?? "Registrazione WARP fallita.")
            ToastCenter.shared.show("Registrazione WARP fallita")
        }
    }

    @MainActor
    private func verifyEgress() async {
        warpBusy = true
        warpState = .working("Verifica egress…")
        defer { warpBusy = false }
        do {
            _ = try await WarpTunnel.shared.start()
        } catch {
            warpState = .failure((error as? LocalizedError)?.errorDescription ?? "Impossibile avviare il tunnel WARP.")
            return
        }
        guard let trace = await WarpTunnel.shared.trace() else {
            warpState = .failure("Egress non raggiungibile.")
            return
        }
        warpState = .egress(warp: trace.warp, ip: trace.ip, colo: trace.colo)
        ToastCenter.shared.show(trace.warp ? "Egress protetto" : "WARP non attivo")
    }
}

private enum WarpUIState {
    case idle
    case working(String)
    case registered
    case egress(warp: Bool, ip: String?, colo: String?)
    case failure(String)
}
