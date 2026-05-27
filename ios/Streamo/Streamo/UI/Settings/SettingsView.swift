import SwiftUI

struct SettingsView: View {
    @Bindable private var settings = AppSettings.shared
    @Environment(Library.self) private var library
    @State private var confirmRecalc = false

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

            Section("Riproduzione") {
                Toggle("Riproduci episodio successivo", isOn: $settings.autoplayNext)
            }

            Section {
                Toggle("Folder nella mia lista", isOn: $settings.foldersEnabled)
            } header: {
                Text("Organizzazione")
            } footer: {
                Text("Raggruppa film e serie in cartelle nella tua lista. Le cartelle si assegnano dalla pagina \"La mia lista\".")
            }

            Section {
                Toggle("Notifiche", isOn: $settings.notificationsEnabled)
                    .onChange(of: settings.notificationsEnabled) { _, on in
                        if on { Task { await NotificationService.shared.requestAuthorizationIfNeeded() } }
                    }
                if settings.notificationsEnabled {
                    Toggle("Nuovi episodi", isOn: $settings.notifyNewEpisodes)
                    Toggle("Nuove stagioni", isOn: $settings.notifyNewSeason)
                    Toggle("Promemoria ripresa", isOn: $settings.notifyResumeReminder)
                }
            } footer: {
                Text("Avvisi per nuovi episodi/stagioni dei titoli in lista e promemoria per riprendere ciò che hai lasciato a metà.")
            }

            Section {
                Button("Ricalcola libreria") { confirmRecalc = true }
            } header: {
                Text("Manutenzione")
            } footer: {
                Text("Rimuove i progressi rimasti appesi dei titoli che hai tolto dalla cronologia e dalla lista, e aggiorna le statistiche e \"Continua a guardare\".")
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
    }

    private var appVersion: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        return v
    }
}
