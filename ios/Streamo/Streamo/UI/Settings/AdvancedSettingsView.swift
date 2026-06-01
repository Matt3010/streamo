import SwiftUI

struct AdvancedSettingsView: View {
    @Bindable private var settings = AppSettings.shared
    @Environment(Library.self) private var library

    @State private var confirmRecalc = false
    @State private var proxyTestState: ProxyTestState = .idle

    var body: some View {
        Form {
            catalogSection
            proxySection

            Section {
                TextField("Locale provider", text: $settings.providerLocale)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.system(.body, design: .monospaced))
                    .onChange(of: settings.providerLocale) { _, _ in
                        proxyTestState = .idle
                    }
            } header: {
                Text("Provider")
            } footer: {
                Text("Lascia `it` per il catalogo italiano. Cambialo solo se il mirror streamingcommunity che usi espone un path locale diverso.")
            }

            Section {
                Button("Ricalcola libreria") { confirmRecalc = true }
            } header: {
                Text("Manutenzione")
            } footer: {
                Text("Rimuove i progressi rimasti appesi dei titoli che hai tolto dalla cronologia e dalla lista, e aggiorna le statistiche e \"Continua a guardare\".")
            }
        }
        .navigationTitle("Avanzate")
        .navigationBarTitleDisplayMode(.inline)
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
    private var proxySection: some View {
        Section {
            Toggle("Usa proxy", isOn: $settings.providerProxyEnabled)
                .onChange(of: settings.providerProxyEnabled) { _, _ in
                    proxyTestState = .idle
                }

            TextField("URL proxy WARP", text: $settings.providerProxyURL)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(.system(.body, design: .monospaced))
                .onChange(of: settings.providerProxyURL) { _, _ in
                    proxyTestState = .idle
                }

            SecureField("Token proxy", text: $settings.providerProxyToken)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(.system(.body, design: .monospaced))
                .onChange(of: settings.providerProxyToken) { _, _ in
                    proxyTestState = .idle
                }

            if let normalized = settings.providerProxyBaseURL {
                LabeledContent("Base URL", value: normalized.absoluteString)
                    .font(.system(.footnote, design: .monospaced))
            }

            Button(proxyButtonTitle) {
                Task { await runProxyTest() }
            }
            .disabled(isTesting)

            switch proxyTestState {
            case .idle:
                EmptyView()
            case .testing:
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Test in corso…")
                        .foregroundStyle(.secondary)
                }
            case .success(let health):
                VStack(alignment: .leading, spacing: 8) {
                    Text("Proxy operativo")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.green)
                    LabeledContent("WARP", value: health.warp ? "Attivo" : "Spento")
                    LabeledContent("Provider", value: health.providerReachable ? "OK" : "Errore")
                    LabeledContent("Vixcloud", value: health.vixcloudReachable ? "OK" : "Errore")
                    if let colo = health.colo, !colo.isEmpty {
                        LabeledContent("Colo", value: colo)
                    }
                }
                .font(.footnote)
            case .failure(let message):
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
        } header: {
            Text("Proxy WARP")
        } footer: {
            Text("Incolla URL e token generato dal proxy. Quando è attivo, l'app non passa automaticamente al collegamento diretto se il server non risponde.")
        }
    }

    private var isTesting: Bool {
        if case .testing = proxyTestState { return true }
        return false
    }

    private var proxyButtonTitle: String {
        switch proxyTestState {
        case .testing: return "Test in corso…"
        default: return "Testa proxy"
        }
    }

    @MainActor
    private func runProxyTest() async {
        guard settings.providerProxyBaseURL != nil else {
            proxyTestState = .failure("Inserisci un URL valido, ad esempio `https://proxy.example.com`.")
            return
        }
        guard settings.hasProviderProxyToken else {
            proxyTestState = .failure("Inserisci il token generato dal proxy.")
            return
        }

        proxyTestState = .testing
        let response = await ProviderProxyClient.shared.healthCheckResult()
        guard let health = response.value else {
            let message = response.error == .unauthorized
                ? "Token proxy non valido."
                : "Proxy non raggiungibile."
            proxyTestState = .failure(message)
            ToastCenter.shared.show(message)
            return
        }

        if health.ok {
            proxyTestState = .success(health)
            ToastCenter.shared.show("Proxy operativo")
            return
        }

        proxyTestState = .failure(failedHealthMessage(health))
        ToastCenter.shared.show("Test proxy fallito")
    }

    private func failedHealthMessage(_ health: ProviderProxyClient.HealthCheck) -> String {
        if !health.warp {
            return "Il proxy risponde ma WARP non è attivo."
        }
        if !health.providerReachable {
            return "Il proxy risponde ma non riesce a raggiungere streamingcommunity."
        }
        if !health.vixcloudReachable {
            return "Il proxy risponde ma non riesce a raggiungere vixcloud."
        }
        if !health.errors.isEmpty {
            return health.errors.joined(separator: ", ")
        }
        return "Test proxy fallito."
    }
}

private enum ProxyTestState {
    case idle
    case testing
    case success(ProviderProxyClient.HealthCheck)
    case failure(String)
}
