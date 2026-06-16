# Piano: Correggere la sezione Cronologia (history) e il "tempo guardato"

## Obiettivo
Verificare e correggere la sezione **Cronologia** in modo che:
- il contatore **"Tempo guardato"** rifletta correttamente il tempo trascorso su ogni episodio/film;
- ogni episodio di una serie appaaccia come riga separata, invece di sovrascrivere la riga della serie;
- la rimozione di una riga cancelli solo quella riga, non tutta la serie;
- le card mostrino la barra di progresso e il badge "Completato" coerenti con lo stato al momento della visione.

## Bug trovati

### 1. `HistoryEntry` ha chiave primaria sbagliata (`tmdbId` solo)
File: `data/local/entity/HistoryEntry.kt`

La chiave primaria è solo `tmdbId`. Per le serie TV questo significa che:
- guardare l'episodio S1E1 e poi S1E2 produce **una sola riga** in `history`, con l'ultimo episodio visto;
- il tempo guardato totale conta **un solo episodio** per serie, non tutti quelli visti;
- la sezione riepilogo mostra "1 episodio visto" anche se ne hai visti molti;
- le chiavi dei composable `LazyVerticalGrid` collidono (`${mediaType}-${tmdbId}`), generando duplicati invisibili o crash.

### 2. Mancano gli snapshot giornalieri di progresso/durata
File: `data/local/entity/HistoryEntry.kt`, `ui/player/PlayerViewModel.kt`

A differenza di iOS, Android non salva nella riga `history` i campi `progressSeconds` e `durationSeconds` (istantanea al momento del salvataggio) né de-dupplica le righe dello stesso episodio nello stesso giorno.
iOS invece:
- inserisce una riga al giorno per ogni episodio guardato;
- se lo stesso episodio viene riaperto nello stesso giorno, **aggiorna** la riga esistente;
- usa lo snapshot per disegnare la barra/blocchi temporali, ma il totale viene calcolato dalla riga `progress` corrente e de-duplicato per coordinata.

### 3. La rimozione cancella l'intera serie
File: `data/local/dao/HistoryDao.kt`, `data/repository/AppRepository.kt`, `ui/history/HistoryViewModel.kt`

`HistoryDao.deleteById(id: Int)` e `AppRepository.removeFromHistory(id: Int)` cancellano **tutte le righe con quel `tmdbId`**. Per una serie, premendo il cestino su un episodio si cancella tutta la cronologia della serie.

### 4. Il totale "Tempo guardato" non de-duplica per coordinata
File: `ui/history/HistoryViewModel.kt`

`totalWatchSeconds` somma ogni riga `history` collegata alla sua `ProgressEntry`. Se in futuro avremo più righe al giorno per lo stesso episodio, verrà conteggiato più volte. iOS invece conta ogni coordinata `(tmdbId, mediaType, season, episode)` una sola volta.

## Soluzione scelta
Allineare Android a iOS mantenendo l'architettura Room esistente.

### Schema `HistoryEntry`
Cambiare la chiave primaria in composita:
```
(tmdbId, mediaType, season, episode, watchedDay)
```
dove `watchedDay` è il timestamp all'inizio del giorno corrente (fuso orario locale).
Aggiungere i campi:
- `watchedDay: Long`
- `progressSeconds: Double = 0.0`
- `durationSeconds: Double = 0.0`

`watchedAt` resta il timestamp esatto per l'ordinamento e il raggruppamento in sezioni.

### DAO e Repository
- `HistoryDao.insert(entry)` continua a usare `OnConflictStrategy.REPLACE`: grazie alla chiave composita, la stessa coordinata nello stesso giorno viene **aggiornata** invece di duplicata.
- Sostituire `deleteById(id: Int)` con `deleteByCoordinate(...)` per cancellare una sola riga.
- Aggiungere `deleteByTmdbId(id: Int)` se in futuro servirà cancellare un titolo intero (non usato ora).
- Aggiornare `AppRepository.removeFromHistory(...)` per ricevere la coordinata completa.

### Migration 11 → 12
Ricreare la tabella `history` con il nuovo schema e migrare i dati esistenti:
1. Creare `history_new` con chiave composita + snapshot.
2. Popolarla con i dati di `history`, derivando `watchedDay` da `watchedAt` (approssimazione UTC sufficiente per dati legacy) e prendendo `progressSeconds`/`durationSeconds` dalla tabella `progress` per la coordinata corrispondente.
3. Droppare `history`, rinominare `history_new` in `history`.
4. Aggiornare `AppDatabase.version` a 12 e aggiungere `MIGRATION_11_12` in `DatabaseModule`.

### Player / Detail
Aggiornare le chiamate `repository.addToHistory(...)` in:
- `PlayerViewModel.onPlaybackEnded()`
- `PlayerViewModel.saveCurrentProgress()`
- `DetailViewModel.markWatched()`

Passare sempre `progressSeconds` e `durationSeconds` (snapshot della posizione/durata corrente). `watchedDay` viene calcolato automaticamente dall'entity tramite default value.

### HistoryViewModel
- Cambiare `remove(id: Int)` in `remove(entry: HistoryEntry)` (o coordinate esplicite) per cancellare la singola riga.
- De-duplicare `totalWatchSeconds` per coordinata, usando la `ProgressEntry` corrente (come iOS).
- Nelle card, usare lo snapshot della riga `history` se disponibile, altrimenti la `ProgressEntry` corrente (fallback per righe legacy).
- Aggiornare la chiave dei composable `LazyVerticalGrid` a `${mediaType}-${tmdbId}-${season}-${episode}` per evitare collisioni tra episodi.
- Aggiornare il riepilogo sezione per contare episodi/film correttamente, includendo gli episodi iniziati (`pos > 15` per coerenza con iOS; attualmente il codice usa `> 10`).

### HistoryScreen
Passare la coordinata completa a `viewModel.remove(...)` tramite l'`HistoryEntry` della card.

## File coinvolti
1. `data/local/entity/HistoryEntry.kt` — nuovo schema + helper `startOfDay`.
2. `data/local/dao/HistoryDao.kt` — nuovi metodi di cancellazione/lookup.
3. `data/local/AppDatabase.kt` — `MIGRATION_11_12`.
4. `di/DatabaseModule.kt` — registrazione della nuova migration.
5. `data/repository/AppRepository.kt` — aggiornare `addToHistory`/`removeFromHistory`.
6. `ui/history/HistoryViewModel.kt` — de-dupe, snapshot, remove corretto, chiavi lazy.
7. `ui/history/HistoryScreen.kt` — passare coordinata completa a `remove()`.
8. `ui/player/PlayerViewModel.kt` — snapshot posizione/durata su `addToHistory`.
9. `ui/detail/DetailViewModel.kt` — snapshot su `addToHistory`.
10. `data/backup/BackupManager.kt` — compatibile automaticamente se i nuovi campi hanno default.

## Passaggi
1. Aggiornare `HistoryEntry` con chiave composita e snapshot.
2. Aggiornare `HistoryDao` e `AppRepository`.
3. Scrivere `MIGRATION_11_12` e registrare migration/versione.
4. Aggiornare `HistoryViewModel` per de-duplicazione, snapshot e remove corretto.
5. Aggiornare `HistoryScreen` per passare la coordinata.
6. Aggiornare `PlayerViewModel` e `DetailViewModel` per passare snapshot.
7. Build: `./gradlew assembleDebug`.
8. Test manuale: guardare più episodi di una serie e verificare che Cronologia mostri una riga per episodio e che "Tempo guardato" sommi correttamente.

## Test e verifiche
- Build debug passa (`./gradlew assembleDebug`).
- Guardare un film: compare una riga in Cronologia, "Tempo guardato" aumenta del tempo effettivo (o della durata se completato).
- Guardare S1E1 e S1E2 di una serie: compaiono **due righe distinte**, non una sola.
- Rivedere S1E1 nello stesso giorno: non si duplica, si aggiorna solo `watchedAt` e lo snapshot.
- Rimuovere S1E1 dalla cronologia: S1E2 resta.
- "Tempo guardato" riflette la somma di tutti gli episodi/film visti, senza contare più volte la stessa coordinata.
- Backup/restore JSON mantiene la nuova tabella (verificare almeno la compilazione; i test unitari sono minimi).

## Considerazioni / rischi
- La migration è distruttiva solo per lo schema `history`, ma preserva i dati legacy trasformandoli nel nuovo formato.
- `watchedDay` per dati legacy viene calcolato in SQL come inizio-giorno UTC: questo può collocare raramente un episodio visto vicino a mezzanotte nel giorno precedente/successivo, ma non crea dati inconsistenti e si autocorregge al prossimo salvataggio.
- Il totale "Tempo guardato" usa la `ProgressEntry` corrente, quindi se ri-guardi lo stesso episodio senza completarlo, il totale aumenta solo fino alla durata effettiva (come da logica `watchTimeSeconds`).
