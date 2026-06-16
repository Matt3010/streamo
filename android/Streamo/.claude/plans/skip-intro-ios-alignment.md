# Piano: Allineare "Salta intro" all'implementazione iOS

## Cosa fa iOS
Il commit `c8b130f1f7a48dae5bcdfe26230512d587c9416e` (branch `origin/ios`) introduce:

1. **`Provider/IntroSkipClient.swift`** — chiama `https://api.theintrodb.org/v3/media` passando:
   - `tmdb_id`
   - `season` + `episode` (solo TV)
   - `duration_ms` (opzionale, per matching del cut)
   - Restituisce `intro` e `credits` con `start_ms` / `end_ms`.

2. **`Player/PlaybackController.swift`** — stato:
   - `SkipPrompt`: `.intro(end)` | `.credits(start)`
   - `skipSegment`: range per l'animazione di riempimento
   - `nextCountdown`: countdown auto-advance sui crediti
   - Fetch segmenti quando l'item è `.readyToPlay`
   - Boundary time observer per aggiornare esattamente ai confini
   - Credits → trigger `onCreditsReached` → arma next-episode countdown
   - `performSkip()`: intro → seek a `end`, credits → next episode o fine
   - `playNextNow()` / `cancelNextEpisode()` per il countdown

3. **`Player/PlayerScreen.swift`** — UI:
   - Pill in basso con riempimento left→right durante il segmento
   - Testi "Salta intro" / "Salta crediti"
   - Countdown "Prossimo episodio (Ns)" + "Annulla"

## Obiettivo Android
Sostituire l'MVP a durata fissa appena implementato con la logica iOS:
- fetch vero da TheIntroDB;
- pill con riempimento;
- skip crediti;
- auto-advance con countdown annullabile.

## File coinvolti

### Nuovi file
- `provider/IntroSkipClient.kt` — client OkHttp+Gson per `api.theintrodb.org/v3/media`.

### Modifiche
1. **`di/NetworkModule.kt`** o `di/AppModule.kt`
   - Fornire `IntroSkipClient` come singleton iniettabile, magari con il OkHttpClient esistente.

2. **`data/preferences/SettingsDataStore.kt`** (già toccato per MVP)
   - Rimuovere `SKIP_INTRO_SECONDS` e i metodi associati: iOS non ha preferenza durata fissa.

3. **`ui/settings/SettingsViewModel.kt`**
   - Rimuovere `_skipIntroSeconds` e `setSkipIntroSeconds`.

4. **`ui/settings/SettingsScreen.kt`**
   - Rimuovere la riga "Salta intro" e il picker a durata fissa.

5. **`ui/player/PlayerViewModel.kt`**
   - Iniettare `IntroSkipClient`.
   - Aggiungere stati: `skipPrompt`, `skipSegment`, `nextCountdown`, `pendingNextEpisode`, `didTriggerNext`.
   - Aggiungere `data class SkipSegment(startMs: Long, endMs: Long)` e `SkipPrompt` enum.
   - Su `onPlaybackStateChanged(STATE_READY)` chiamare `maybeFetchSkipSegments()`.
   - Polling posizione già esiste ogni 1s: usarlo per `updateSkipPrompt()`.
   - Aggiungere `skipIntro()`, `skipCredits()`, `performSkip()`, `armNextEpisode()`, `playNextNow()`, `cancelNextEpisode()`.
   - Integrare con `playNextEpisode()` esistente per l'auto-advance.
   - Saltare fetch se offline (`isOfflinePlayback`) o se `tmdbId == 0`.

6. **`ui/player/PlayerScreen.kt`**
   - Aggiungere pill "Salta intro" / "Salta crediti" in basso sopra/al posto del badge WARP/prossimo episodio, con riempimento animato.
   - Aggiungere countdown "Prossimo episodio (Ns)" con bottone Annulla.
   - Rimuovere il pill MVP precedentemente aggiunto.

## Design UI Android
A differenza di iOS, Android ha controlli full-screen custom. Proporrei:
- Pill glass in basso a destra (vicino a "Prossimo episodio") quando c'è uno skip prompt.
- Il pill mostra testo + una barra di riempimento orizzontale sotto/sopra.
- Quando il countdown è attivo, mostriamo la stessa pill con "Prossimo episodio (8s)" e un secondo bottone/area "Annulla".

## Passaggi
1. Creare `IntroSkipClient.kt`.
2. Iniettarlo via Hilt.
3. Rimuovere la preferenza durata fissa da DataStore/Settings.
4. Aggiornare `PlayerViewModel` con logica segmenti/skip/credits/countdown.
5. Aggiornare `PlayerScreen` con pill e countdown.
6. Build e verifiche.

## Considerazioni
- TheIntroDB è a API keyless; timeout 8s; se fallisce o non ha dati, nessun bottone, nessuna regressione.
- Offline playback: non fetchare segmenti (iOS salta per `offlineURL`).
- Android non ha anime, quindi nessun caso speciale come iOS.
- Il countdown crediti usa `TVLogic.nextEpisode` già presente.
- `didTriggerNext` evita doppio autoplay sia da crediti che da fine stream.
