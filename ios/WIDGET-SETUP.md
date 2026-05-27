# Widget "Continua a guardare" — setup in Xcode

Il codice è già scritto. Mancano solo i passi che vanno fatti da Xcode (target +
capability), perché un secondo target e l'App Group non si possono creare a mano
in modo affidabile.

## 1. Crea il target Widget Extension
- **File → New → Target… → Widget Extension**.
- Product Name: **StreamoWidget**.
- **Deseleziona** "Include Live Activity" e "Include Configuration App Intent"
  (usiamo `StaticConfiguration`).
- Finish → "Activate" lo scheme se chiede.

Xcode crea una cartella `StreamoWidget/` con dei file di esempio.

## 2. Usa il mio codice del widget
- `StreamoWidget/StreamoWidget.swift` è già stato sostituito con il mio codice
  (il widget si chiama `StreamoWidget`, senza `@main`).
- `StreamoWidget/StreamoWidgetBundle.swift` generato da Xcode resta com'è
  (ha il `@main` e referenzia `StreamoWidget()`). **Non cancellare nulla.**

## 3. Condividi il modello dati col widget
- Nel Project Navigator seleziona `Streamo/Widget/WidgetSnapshot.swift`.
- Nel **File Inspector → Target Membership** spunta anche **StreamoWidget**
  (deve essere membro sia dell'app che del widget).

## 4. App Group (condivisione dati)
Su **entrambi** i target (app **Streamo** e **StreamoWidget**):
- Target → **Signing & Capabilities → + Capability → App Groups**.
- Aggiungi lo stesso gruppo: **`group.com.streamo.app`**.

⚠️ Deve combaciare con `WidgetShared.appGroup`. Se usi un id diverso,
cambialo in `WidgetSnapshot.swift`.

## 5. Build & run
- Avvia l'app, guarda qualcosa (così si popola "Continua a guardare").
- Tieni premuto sulla home → "+" → cerca **Streamo** → aggiungi il widget
  (small o medium).
- Tap sul widget → apre il titolo (deep link `streamo://`, già gestito dall'app).

## Come funziona
- L'app scrive uno snapshot di "Continua a guardare" nello UserDefaults
  dell'App Group a ogni salvataggio (`Library.updateWidgetSnapshot`).
- Al passaggio in background l'app fa `WidgetCenter.reloadAllTimelines()`.
- Il widget legge lo snapshot, scarica il poster e mostra titolo + S/E + barra
  di progresso; il tap apre il titolo via `streamo://open?...`.
