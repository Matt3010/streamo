# Piano: Pulsante "Salta intro" nel player

## Obiettivo
Aggiungere nel player un pulsante **"Salta intro"** visibile all'inizio degli episodi TV, che salti in avanti della durata configurata dall'utente.

## Vincoli
- TMDB e il provider (StreamingCommunity → Vixcloud) **non forniscono timestamp inizio/fine intro**: l'app non ha a disposizione metadati su dove finisca la sigla.
- iOS usa `AVPlayerViewController` nativo e non ha questa funzione; quindi non c'è un riferimento diretto da portare.
- Il bottone deve funzionare sia in riproduzione locale che in cast (DLNA/Obsidian) e rispettare lo stile glass/italiano dell'app.

## Soluzione scelta
Implementazione **MVP a durata fissa configurabile**, simile al "Skip Intro" di prima generazione:
1. L'utente sceglie in Impostazioni quanti secondi saltare (default 90s): opzioni **Disattivato / 30s / 60s / 90s / 120s**.
2. Per gli episodi TV, durante la finestra `0s → durata intro`, mostriamo un pill button "Salta intro".
3. Al tap il player cerca al tempo `min(durata intro, durata totale - 5s)`, in modo da non saltare oltre la fine del contenuto.
4. I film non mostrano il bottone (l'introduzione di un film non è standardizzabile con una durata fissa).
5. Il salto usa i meccanismi esistenti di seek, quindi funziona anche durante il cast.

Questa è la base più solida. In futuro si può arricchire con:
- durata personalizzata per serie (salvata in DataStore/Room);
- query a servizi esterni di intro detection;
- euristica audio/video on-device (molto più complessa).

## File coinvolti

### 1. `data/preferences/SettingsDataStore.kt`
- Nuova chiave `SKIP_INTRO_SECONDS` (int, default 90; 0 = disattivato).
- Esporre `skipIntroSeconds: Flow<Int>` e `setSkipIntroSeconds(value: Int)`.

### 2. `ui/settings/SettingsViewModel.kt`
- Aggiungere `_skipIntroSeconds` e `val skipIntroSeconds: StateFlow<Int>`.
- In `init` raccogliere il valore da DataStore.
- Aggiungere `setSkipIntroSeconds(value: Int)`.

### 3. `ui/settings/SettingsScreen.kt`
- Nella sezione "Riproduzione", aggiungere una riga "Salta intro" con il valore attuale (es. "90 secondi" / "Disattivato").
- Al tap aprire un `GlassAlertDialog` con le opzioni Disattivato/30/60/90/120.

### 4. `ui/player/PlayerViewModel.kt`
- Aggiungere `_skipIntroEndMs = MutableStateFlow(0L)` e `_skipIntroVisible = MutableStateFlow(false)` esposti come `StateFlow`.
- In `load()`, dopo aver letto la durata/il tipo, calcolare:
  - se `mediaType == "tv"`, `season > 0` e `skipIntroSeconds > 0` → `skipIntroEndMs = skipIntroSeconds * 1000L`.
- Aggiornare `skipIntroVisible` in base a `currentPosition < skipIntroEndMs && duration > skipIntroEndMs`.
- Aggiungere `fun skipIntro()` che chiama `seekTo(min(skipIntroEndMs, duration - 5000).coerceAtLeast(0))`, gestendo anche il cast con `castController.seekTo(...)`.

### 5. `ui/player/PlayerScreen.kt`
- Collezionare `skipIntroVisible` dal ViewModel.
- Disegnare il pill "Salta intro" sopra i controlli centrali (o in basso vicino al bottone "Prossimo episodio") quando i controlli sono visibili e `skipIntroVisible` è true.
- Stile coerente con l'app: sfondo scuro semi-trasparente/bordo sottile, testo bianco, icona `SkipNext` o `Forward10`.
- Al tap: `resetControls(); viewModel.skipIntro()`.

### 6. (Opzionale) `data/backup/BackupManager.kt`
- Includere la nuova preferenza nel backup JSON così da non perderla su import/export (se il backup esporta tutte le preference).

## Passaggi
1. Aggiungere la preferenza in `SettingsDataStore`.
2. Esporre la preferenza in `SettingsViewModel` e aggiungere l'UI in `SettingsScreen`.
3. In `PlayerViewModel` calcolare la finestra intro e implementare `skipIntro()`.
4. In `PlayerScreen` aggiungere il pill button con transizioni `AnimatedVisibility`.
5. Verificare che il bottone si nasconda quando:
   - la posizione supera la finestra intro;
   - il contenuto è un film;
   - l'utente ha impostato "Disattivato";
   - la durata è troppo breve.
6. Verificare la build con `./gradlew assembleDebug`.

## Test e verifiche
- Build debug.
- Avviare un episodio TV: il bottone deve apparire entro i primi N secondi e scomparire dopo.
- Tappare "Salta intro": il player deve saltare al tempo configurato e continuare a riprodurre.
- Verificare che in cast DLNA/Obsidian il seek avvenga anche sulla TV.
- Verificare che i film non mostrino il bottone.
- Verificare che impostando "Disattivato" il bottone non compaia mai.

## Considerazioni / rischi
- Saltare oltre la fine del video: gestito con `coerceAtMost(duration - 5s)`.
- Il bottone è utile principalmente per serie con sigla fissa all'inizio; se un episodio ha un cold open più lungo della durata configurata, il salto atterrerebbe dentro l'episodio (limitazione nota dell'approccio MVP).
- Il pill non deve coprire il play/pause: posizionato sopra o a lato dei controlli centrali.
