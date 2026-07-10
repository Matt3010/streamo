# Piano allineamento stili — vidaaos ↔ Android TV (Streamo)

**Obiettivo**: rendere la UI di `vidaaos` (Preact/CSS) visivamente identica al layout **TV**
dell'app Android Streamo (`android/Streamo`, package `ui/tv/*`) per Home, Dettaglio, card,
episodi e rail.

**Contesto per l'esecutore**: vidaaos è GIÀ nato come porting del design TV Android. Il file
`src/styles.css` è un design-system che dichiara di rispecchiare `ui/theme/Color.kt` +
`ui/tv/common/*`. Token surfaces, focus, scrim, drawer combaciano già. **Questo piano NON
riscrive il design system**: corregge solo le divergenze residue elencate qui sotto, una per
una. Ogni task ha: file, punto esatto, valore ATTUALE → valore TARGET, motivo, e verifica.

**Regole per chi esegue (modello open-source)**:
1. Fai UN task alla volta, nell'ordine. Non accorpare.
2. Non toccare logica di focus/navigazione (`src/spatial/*`, `useFocusable`, Norigin),
   store, data layer, player. Solo stile: `src/styles.css` e i componenti citati.
3. Non introdurre dipendenze, non aggiungere librerie CSS, non usare blur/glass
   (VIDAA Chromium vecchio non lo regge — è una scelta di design vincolante).
4. Ogni valore in `dp`/`sp` di Android → stesso numero in `px` (target 1080p, 1dp==1px).
5. Dopo ogni task esegui `npm run build` (o `rtk tsc`) e verifica che compili.

**Regole per il revisore (modello debole)**: per ogni task verifica SOLO che il diff cambi
esattamente i valori indicati nella colonna TARGET, sui selettori/file indicati, senza toccare
altro. La sezione "Verifica" di ogni task è il criterio di accettazione.

**File sorgente Android di riferimento** (sola lettura, non si modificano):
- `app/src/main/java/com/streamo/app/ui/theme/{Color,Type,Theme}.kt`
- `app/src/main/java/com/streamo/app/ui/tv/common/{TvMediaCard,TvProgressMediaCard,TvSectionRow,TvImmersiveRow,TvFocusModifiers}.kt`
- `app/src/main/java/com/streamo/app/ui/tv/home/TvHomeScreen.kt`
- `app/src/main/java/com/streamo/app/ui/tv/detail/TvDetailScreen.kt`

**File vidaaos da modificare**:
- `src/styles.css` (la maggior parte dei task)
- `src/components/{ProgressMediaCard,EpisodeCard,Icon,ImmersiveRow}.tsx`
- `src/player/ControlsOverlay.tsx` (Fase K)
- `src/screens/{DetailScreen,LibraryScreen}.tsx`
- (Search/SectionList/Settings: quasi tutto via `styles.css`; markup toccato solo in
  `LibraryScreen.tsx`, `DetailScreen.tsx` e `ControlsOverlay.tsx`)

**File Android di riferimento aggiuntivi** (sola lettura) per Fasi G-K:
- `ui/tv/search/TvSearchScreen.kt`, `ui/tv/sectionlist/TvSectionListScreen.kt`
- `ui/tv/library/TvLibraryScreen.kt`, `ui/tv/settings/TvSettingsScreen.kt`
- `ui/tv/player/TvPlayerScreen.kt`

---

## Tabella valori di riferimento (Android → vidaaos)

| Elemento | Android (dp/sp) | vidaaos attuale | Target |
|---|---|---|---|
| Raggio poster/still card | `RoundedCornerShape(9.dp)` | `8px` | `9px` |
| Larghezza poster card | `140.dp` | `140px` | ok |
| Larghezza still episodio | `260.dp` | `260px` | ok |
| Gap orizzontale rail | `spacedBy(14.dp)` | `14px` | ok |
| Scala focus poster | `1.05f` | `1.05` | ok |
| Label card focus | bianco (`Color.White`) | non cambia | bianco |
| Font label card | `labelMedium` = 12sp | `13px` | `12px` |
| Font titolo sezione | `titleMedium` = 16sp / 500 | `20px` / 600 | `16px` / 500 (T-F1) |
| Padding orizz. Detail | `48.dp` | `32px` | `48px` (T-C0) |
| Posizione titolo Detail | `56 + 140` = ~196dp dall'alto | `margin-top:320px` | `196px` (T-C0) |
| Larghezza titolo/trama Detail | `70%` / `60%` viewport | `max-width:760px` | `70vw` / `60vw` (T-C0/C4) |
| Titolo dettaglio | `displaySmall` ≈ 36sp bold | `36px` bold | ok |
| Badge icona sezione | `30.dp` box r=8 + icona 16.dp | `30px` r=8 + 16px | ok |
| Progress bar altezza | `3.dp`, track trasparente | `3px`, track `rgba(0,0,0,.4)` | track trasparente |
| Griglia Search/SectionList | `GridCells.Fixed(5)` | `auto-fill minmax(180px)` (~9-10 col) | `repeat(5,1fr)` (T-G1) |
| Chip filtro Search | pill riempita | pill outline | filled (T-H1) |
| Layout Settings | full-width, padding 48dp | colonna centrata 720px | full-width 48px (T-J1) |
| Titolo Settings | `headlineMedium` = 20sp/600 | `28px`/700 | `20px`/600 (T-J3) |
| Bottone player a fuoco | cerchio bianco pieno + icona nera, scala 1.12 | `White@0.12` + anello | bianco/nero + scala (T-K1) |
| Pill "Prossimo ep." | `Black@0.65` + bordo, focus bianco/nero | primary pieno | Android (T-K3) |

---

## FASE A — Card condivise (MediaCard / poster / still)

### T-A0 — Focus ring rotondo robusto su VIDAA (PRIORITÀ ALTA)
**File**: `src/styles.css`
**Problema**: le card mostrano il focus con `outline: 3px solid` (righe ~82-89, ~262-264).
Su Chromium VECCHIO (VIDAA) `outline` NON segue `border-radius` → l'anello appare
**quadrato** attorno a un poster arrotondato. Android usa un `border` (sempre arrotondato).
**Fix**: sostituire l'anello di focus dei riquadri da `outline` a `box-shadow` con spread
(che rispetta sempre il raggio, nessun layout shift, come `border` ma senza occupare spazio).

ATTUALE:
```css
.focusable.f-focus.frame {
  outline: 3px solid var(--focus-ring);
}
.card-focus.f-focus .card-poster {
  outline: 3px solid var(--focus-ring);
}
```
TARGET:
```css
.focusable.f-focus.frame {
  box-shadow: 0 0 0 3px var(--focus-ring);
}
.card-focus.f-focus .card-poster {
  box-shadow: 0 0 0 3px var(--focus-ring);
}
```
Anche l'anello sottile chip/row (`.focusable.f-focus.ring`, riga ~87): cambiare
`outline: 2px solid var(--focus-ring);` → `box-shadow: 0 0 0 2px var(--focus-ring);`.
Rimuovere le due righe `outline: 0 solid transparent;` diventate inutili in `.focusable`
(riga ~72) e `.card-poster` (riga ~255) SOLO se non servono altrove — in dubbio lasciarle.
**Verifica**: build ok; su emulatore VIDAA/Chromium vecchio l'anello bianco su una card in
focus è arrotondato agli angoli, non squadrato.

### T-A1 — Raggio card a 9px
**File**: `src/styles.css`
Cambiare `border-radius: 8px` → `9px` in questi tre selettori:
- `.card-poster` (riga ~248)
- `.card-still` (riga ~270)
- `.altro-card` (riga ~608)
**Motivo**: Android `RoundedCornerShape(9.dp)` in TvMediaCard/TvProgressMediaCard/TvEpisodeCard.
**Verifica**: i tre selettori riportano `9px`; nessun altro `border-radius` toccato.

### T-A2 — La label della card si illumina in focus (BUG attuale)
**File**: `src/styles.css`
**Problema**: Android porta la label a `Color.White` quando la card è in focus. In vidaaos
esiste la regola `.card-label.focused { color: var(--on-surface); }` (riga ~288) ma la classe
`focused` non viene MAI applicata (i componenti non la settano) → la label resta grigia.
**Fix**: aggiungere una regola discendente basata sullo stato di focus reale del wrapper:
```css
.card-focus.f-focus .card-label {
  color: var(--on-surface);
}
```
(inserirla vicino a `.card-focus.f-focus .card-poster`). La vecchia `.card-label.focused` può
restare inerte o essere rimossa.
**Verifica**: mettendo in focus una MediaCard, il testo sotto il poster diventa bianco;
fuori focus torna `#b0b0b0`.

### T-A3 — Font label card 13px → 12px (minore)
**File**: `src/styles.css`, selettore `.card-label` (riga ~281): `font-size: 13px;` → `12px;`.
**Motivo**: Android `typography.labelMedium` = 12sp.
**Verifica**: `.card-label` = `12px`.

---

## FASE B — ProgressMediaCard (Continua a guardare)

Riferimento Android: `ui/tv/common/TvProgressMediaCard.kt`.

### T-B1 — Sfumatura inferiore sul poster progress
**File**: `src/components/ProgressMediaCard.tsx`
**Problema**: Android disegna un gradiente `transparent → Black@0.5` sul poster (righe 120-128
del .kt). vidaaos non ne ha (a differenza di EpisodeCard che usa `.card-gradient`).
**Fix**: dentro `<div class="card-poster">`, prima del badge, aggiungere un overlay dedicato
(gradiente più leggero di quello episodi, quindi NON riusare `.card-gradient` che è @0.75):
```tsx
<div class="progress-gradient" />
```
**File**: `src/styles.css` — nuova regola:
```css
.progress-gradient {
  position: absolute;
  inset: 0;
  background: linear-gradient(0deg, rgba(0, 0, 0, 0.5) 0%, rgba(0, 0, 0, 0) 45%);
}
```
**Verifica**: la card progress ha un velo scuro in basso; il badge S/E e la progress bar
restano leggibili sopra.

### T-B2 — Track progress bar trasparente
**File**: `src/styles.css`, `.progress-bar` (riga ~304).
ATTUALE: `background: rgba(0, 0, 0, 0.4);` → TARGET: `background: transparent;`
**Motivo**: Android `LinearProgressIndicator(trackColor = Color.Transparent)`.
Lasciare invariato `.progress-bar > .fill { background: var(--primary); }`.
**Verifica**: dietro la barra non c'è più la scia scura; si vede solo il fill primary.

### T-B3 — Sottotitolo "X min rimasti" sotto la progress card
**File**: `src/components/ProgressMediaCard.tsx`
**Problema**: Android mostra una riga di testo sotto il titolo con il tempo rimanente
(righe 172-190 del .kt): formato `"{h}h {m}min rimasti"` / `"{m} min rimasti"` /
`"pochi secondi"`. vidaaos mostra solo il titolo.
**Fix**: aggiungere sotto `<div class="card-label">` una riga con il tempo rimanente.
Calcolo (porta esatta della logica Android, usando i campi già presenti su `entry`):
```tsx
const remaining = Math.max(0, Math.floor(entry.durationSeconds - entry.positionSeconds));
const h = Math.floor(remaining / 3600);
const m = Math.floor((remaining % 3600) / 60);
const remainingText =
  entry.durationSeconds > 0
    ? h > 0
      ? `${h}h ${m}min rimasti`
      : m > 0
        ? `${m} min rimasti`
        : 'pochi secondi'
    : null;
```
Markup (dopo la label):
```tsx
{remainingText && <div class="card-sublabel">{remainingText}</div>}
```
**File**: `src/styles.css` — nuova regola:
```css
.card-sublabel {
  margin-top: 2px;
  font-size: 11px;
  color: var(--on-surface-variant);
  width: 140px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```
**Nota**: le stringhe restano in italiano hardcoded come su Android (non esiste chiave i18n
per queste; non inventarne). `font-size: 11px` ≈ Android `labelSmall` (10sp), tenuto a 11 per
leggibilità TV.
**Verifica**: una card "Continua a guardare" con progresso mostra sotto il titolo, es.,
`"1h 12min rimasti"`; una senza durata non mostra la riga.

---

## FASE C — Schermata Dettaglio

Riferimento Android: `ui/tv/detail/TvDetailScreen.kt`.

> **Questa fase è la più importante**: la Detail di vidaaos diverge da Android soprattutto per
> **struttura e posizionamento**, non solo per colori. Eseguire **T-C0 per prima**: senza quella,
> i task cromatici (C1-C5) applicano stili giusti su un layout sbagliato.

### T-C0 — Ristrutturazione layout Detail (POSIZIONAMENTO — PRIORITÀ MASSIMA)
**File**: `src/screens/DetailScreen.tsx` + `src/styles.css`

**Modello Android da replicare** (TvDetailScreen.kt righe 139-464):
- Il backdrop è un **layer di sfondo** (`fillMaxWidth().height(560.dp)`, ancorato in alto)
  con due scrim sopra (sinistra scura + fade verticale al nero in basso).
- **Tutto** il contenuto (titolo, meta, generi, bottoni, trama, cast, episodi, consigliati)
  scorre in **una singola colonna** SOPRA e SOTTO il backdrop (`LazyColumn` fillMaxSize).
- Padding orizzontale contenuto = **48dp**. Padding top colonna = 56dp + Spacer 140dp →
  il **titolo parte a ~196dp dall'alto** (circa 1/3 dentro il backdrop da 560).
- Larghezza testo: **titolo 70%** viewport (`fillMaxWidth(0.7f)`), **trama 60%**
  (`fillMaxWidth(0.6f)`).

**Divergenze vidaaos ATTUALI** (da correggere):
1. `.detail-content` è **annidato dentro** `.detail-hero` (fisso `height:560px`) → contenuto
   costretto in una scatola 560px, e la sezione episodi (sibling dopo l'hero) è forzata a
   partire a y=560 **sovrapponendosi al cast** se il contenuto è alto (BUG di overlap).
2. Titolo a `margin-top: 320px` (Android ~196) → troppo in basso.
3. Colonna `max-width: 760px` (Android 70vw/60vw) → testo troppo stretto/schiacciato.
4. Padding orizzontale 32px (Android detail = 48).

**FIX — struttura DOM** (`DetailScreen.tsx`): spostare `.detail-content` a **sibling** di
`.detail-hero` (non più figlio). L'hero resta solo backdrop+scrim.
ATTUALE (righe ~139-188):
```tsx
<div class="detail-hero" style={{ backgroundImage: ... }}>
  <div class="detail-scrim" />
  <div class="detail-content">
    ... titolo / meta / generi / azioni / trama / cast ...
  </div>
</div>
```
TARGET:
```tsx
<div class="detail-hero" style={{ backgroundImage: ... }}>
  <div class="detail-scrim" />
</div>
<div class="detail-content">
  ... titolo / meta / generi / azioni / trama / cast ...
</div>
```
(cioè: chiudere `.detail-hero` subito dopo `.detail-scrim`; `.detail-content` diventa fratello.
Il resto del contenuto interno di `.detail-content` NON cambia in questo task.)

**FIX — CSS** (`src/styles.css`):
`.detail-screen` — impostare il padding orizzontale dei rail di questa schermata a 48px
sovrascrivendo la variabile (così episodi, chip stagione, consigliati e titoli sezione della
Detail si allineano a 48, come Android, senza toccare la Home che resta a 32):
```css
.detail-screen {
  background: var(--surface-0);
  --rail-h-pad: 48px;
}
```
(unire con la regola `.detail-screen` già esistente più in basso — riga ~697 — non duplicarla.)

`.detail-hero` (righe ~480-486) → backdrop come layer di sfondo:
```css
.detail-hero {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 560px;
  z-index: 0;
  background-size: cover;
  background-position: center top;
}
```

`.detail-content` (righe ~494-498) → colonna in flusso sopra il backdrop:
```css
.detail-content {
  position: relative;
  z-index: 1;
  padding: 196px 48px 48px;
}
```
(rimosso `max-width: 760px`.)

`.detail-title` (righe ~701-706) → togliere il margin-top, aggiungere larghezza 70vw:
```css
.detail-title {
  font-size: 36px;
  font-weight: 700;
  margin-top: 0;
  max-width: 70vw;
  line-height: 1.1;
}
```

`.detail-overview` (già toccato in T-C4) → larghezza 60vw invece di 720px (vedi T-C4 aggiornato).

**Verifica**:
- Il titolo appare a ~196px dall'alto, sopra il backdrop (circa a un terzo), non a metà.
- Titolo e trama occupano una colonna larga (~70%/60% schermo), non un blocco stretto centrale.
- Scorrendo, il backdrop scorre via insieme al contenuto; episodi e consigliati seguono
  la trama SENZA sovrapporsi al cast.
- Su una serie con molti episodi non c'è più overlap tra cast e riga episodi.
- Padding sinistro di titolo, chip stagione e card episodio allineati a 48px.

### T-C1 — Bottone "La mia lista" (watchlist) riempito, non bordato
**File**: `src/styles.css`
**Problema**: Android rende il bottone watchlist come **riempito** `White@0.12`; in focus
diventa quasi-bianco (`White@0.95`) con testo/icona **neri** (righe 296-315 del .kt). vidaaos
lo rende trasparente con bordo `White@0.2`, e in focus resta scuro (`.wl-btn` righe ~747-750).
**Fix**: allineare al pattern di `.play-btn` (focus → bianco/nero).
ATTUALE:
```css
.wl-btn {
  color: var(--on-surface);
  border: 1px solid rgba(255, 255, 255, 0.2);
}
```
TARGET:
```css
.wl-btn {
  color: var(--on-surface);
  background: rgba(255, 255, 255, 0.12);
}
.wl-btn.f-focus.fill {
  background: #fff;
  color: #000;
}
```
**Nota**: il markup in `DetailScreen.tsx` già passa `fill` al `Focusable` del bottone wl
(riga ~166), quindi la classe `.f-focus.fill` si attiva da sola. Non toccare il TSX.
**Verifica**: bottone watchlist con leggero riempimento bianco a riposo; in focus diventa
bianco pieno con testo/icona nere, identico al comportamento del bottone Play.

### T-C2 — Chip stagione "riempite" (filled), non outline
**File**: `src/styles.css`
**Problema**: Android usa chip stagione riempite (righe 367-388 del .kt):
- default: sfondo `White@0.12`, testo bianco
- selezionata: sfondo `primary`, testo `onPrimary`
- in focus: sfondo `White` (bianco pieno), testo nero
vidaaos usa chip outline: selezionata = testo+bordo primary su fondo trasparente (righe ~792-805).
**Fix**:
ATTUALE:
```css
.season-chip {
  flex: 0 0 auto;
  padding: 8px 16px;
  border-radius: 8px;
  color: var(--on-surface-variant);
  font-size: 14px;
  font-weight: 600;
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.season-chip.selected {
  color: var(--primary);
  border-color: var(--primary);
}
```
TARGET:
```css
.season-chip {
  flex: 0 0 auto;
  padding: 8px 16px;
  border-radius: 8px;
  color: var(--on-surface);
  font-size: 14px;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.12);
}
.season-chip.selected {
  background: var(--primary);
  color: var(--primary-on);
}
.season-chip.f-focus.fill {
  background: #fff;
  color: #000;
}
```
**Nota**: il `Focusable` della chip già passa `ring fill` (DetailScreen.tsx riga ~204); con la
nuova `.season-chip.f-focus.fill` il focus diventa bianco/nero. La classe `.selected` è già
applicata dal TSX. Non toccare il TSX. Se `ring` disegna anche un box-shadow bianco (dopo
T-A0), va bene: replica il bordo di focus.
**Verifica**: 3 stati distinti — normale (grigio riempito), selezionata (primary pieno),
in focus (bianco pieno testo nero).

### T-C3 — Icona sezione "Episodi" = play_circle (non play_arrow)
**File**: `src/screens/DetailScreen.tsx` (riga ~180) e `src/components/Icon.tsx`.
**Problema**: Android usa `Icons.Filled.PlayCircle` per il titolo "Episodi" (TvDetailScreen
riga ~343); vidaaos passa `ICON_PATHS.playArrow`.
**Fix**: in `Icon.tsx` aggiungere a `ICON_PATHS` la chiave `playCircle` (stesso glifo già
presente in `homeSections.ts` → `SECTION_ICONS.continueWatching`):
```ts
playCircle: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 12 2zM9.5 16.5v-9l7 4.5l-7 4.5z',
```
In `DetailScreen.tsx`, il `SectionTitle` degli episodi: `icon={ICON_PATHS.playArrow}` →
`icon={ICON_PATHS.playCircle}`.
**Verifica**: il badge accanto a "Episodi" mostra un cerchio con play dentro.

### T-C4 — Overview: colore, larghezza e clamp
**File**: `src/styles.css`, `.detail-overview` (righe ~752-758).
Android: `White@0.85`, larghezza 60% (`fillMaxWidth(0.6f)`), max 4 righe. vidaaos:
`on-surface-variant` (#b0b0b0), `max-width:720px`, nessun clamp.
TARGET:
```css
.detail-overview {
  margin-top: 20px;
  font-size: 15px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.85);
  max-width: 60vw;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```
**Verifica**: overview bianca semi-trasparente, larga ~60% schermo, tagliata a 4 righe con ellissi.

### T-C5 — Meta/generi: tinte bianco semi-trasparente (minore)
**File**: `src/styles.css`.
Android: meta = `White@0.85` (bodyLarge), generi = `White@0.6` (bodyMedium).
- `.detail-meta` (riga ~708): `color: var(--on-surface-variant);` → `color: rgba(255,255,255,0.85);`
- `.detail-genres` (riga ~714): `color: var(--on-surface-variant);` → `color: rgba(255,255,255,0.6);`
**Verifica**: meta leggermente più chiara dei generi.

### T-C6 — Cast su riga singola (DECISO: replica fedele)
**File**: `src/screens/DetailScreen.tsx` + `src/styles.css`
Android TV mostra il cast come **una singola riga** `"Cast: nome, nome, …"` (bodySmall,
`White@0.6`, TvDetailScreen righe 332-342), NON come rail di card. Per la parità richiesta si
allinea ad Android.
**Fix TSX**: sostituire il blocco `.cast-row` (DetailScreen.tsx righe ~177-186):
```tsx
{cast.length > 0 && (
  <div class="cast-row">
    {cast.map((c) => (
      <div class="cast-item" key={c.id}>
        <div class="cast-name">{c.name}</div>
        {c.character && <div class="cast-char">{c.character}</div>}
      </div>
    ))}
  </div>
)}
```
con:
```tsx
{cast.length > 0 && (
  <div class="detail-cast-line">
    Cast: {cast.map((c) => c.name).join(', ')}
  </div>
)}
```
**Fix CSS**: rimuovere le regole `.cast-row`, `.cast-item`, `.cast-name`, `.cast-char`
(righe ~760-783) e la voce `.cast-row` dalla lista scroll-container nascosti (righe ~907-927,
sia in `scrollbar-width:none` che in `::-webkit-scrollbar`). Aggiungere:
```css
.detail-cast-line {
  margin-top: 12px;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.6);
  max-width: 60vw;
}
```
**Verifica**: sotto la trama compare una sola riga "Cast: Nome, Nome, …" grigia; non c'è più
la fila di card cast.

---

## FASE D — Card episodio (Dettaglio)

Riferimento Android: `TvDetailScreen.kt` → `TvEpisodeCard` (righe 476-590).
vidaaos: `src/components/EpisodeCard.tsx` + CSS `.card-still`, `.episode-num`, `.episode-status`.

### T-D1 — Numero episodio: testo bianco semplice, non pill
**File**: `src/components/EpisodeCard.tsx` + `src/styles.css`.
**Problema**: Android mostra il numero episodio come testo bianco grande (titleMedium ≈16sp)
in basso a sinistra, **senza sfondo**, e mostra solo il numero (es. `3`). vidaaos mostra un
pill scuro `E3` a 11px.
**Fix TSX** (`EpisodeCard.tsx`): `{`E${ep.episode_number}`}` → `{ep.episode_number}`.
**Fix CSS** (`.episode-num`, righe ~631-633): togliere sfondo/padding pill, ingrandire:
```css
.episode-num {
  left: 8px;
  bottom: 8px;
  background: none;
  padding: 0;
  font-size: 16px;
  font-weight: 600;
}
```
(rimuovere `.episode-num` dalla regola condivisa `.episode-num, .episode-status { background... }`
alle righe ~619-629: separare i due selettori così `.episode-status` tiene il pill scuro e
`.episode-num` no.)
**Verifica**: sullo still episodio si legge il numero grande bianco senza riquadro; lo stato
(✓/%) a destra resta col pill scuro.

### T-D2 — Nome episodio + overview sotto lo still
**File**: `src/components/EpisodeCard.tsx` + `src/styles.css`.
**Problema**: Android mostra sotto lo still: nome episodio (labelMedium, bianco/85%) e overview
su 2 righe (labelSmall, bianco/55%) (righe 571-587 del .kt). vidaaos non mostra nulla sotto.
**Fix TSX**: dopo `</div>` dello `.card-still`, aggiungere:
```tsx
<div class="episode-name">{ep.name || `Episodio ${ep.episode_number}`}</div>
<div class="episode-overview">{ep.overview || ''}</div>
```
**Fix CSS** — nuove regole:
```css
.episode-name {
  margin-top: 6px;
  width: 260px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-focus.f-focus .episode-name {
  color: #fff;
}
.episode-overview {
  margin-top: 2px;
  width: 260px;
  font-size: 10px;
  line-height: 1.35;
  color: rgba(255, 255, 255, 0.55);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 27px; /* riserva 2 righe: baseline card allineate anche senza overview */
}
```
**Verifica**: ogni card episodio mostra nome (1 riga) e descrizione (max 2 righe) sotto lo
still; il nome si illumina bianco in focus; card con overview vuota mantengono la stessa
altezza (min-height).

### T-D3 — Icona play/replay al centro dello still in focus
**File**: `src/components/EpisodeCard.tsx` + `src/styles.css`.
**Problema**: Android mostra un'icona Play (o Replay se già visto) 44dp al centro dello still
quando la card è in focus (righe 550-557 del .kt). vidaaos non la mostra.
**Fix TSX**: dentro `<div class="card-still">`, dopo `.card-gradient`, aggiungere l'icona play
(sempre nel DOM, mostrata solo in focus via CSS — evita di dover leggere lo stato focus in JS):
```tsx
<span class="episode-play">
  <InlineIcon path={ICON_PATHS.playArrow} size={44} />
</span>
```
Importare in cima al file: `import { InlineIcon, ICON_PATHS } from './Icon';`
**Fix CSS**:
```css
.episode-play {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  opacity: 0;
  pointer-events: none;
}
.card-focus.f-focus .episode-play {
  opacity: 1;
}
```
**Nota**: lo stato "watched → icona Replay" dipende dal progresso episodio che in vidaaos è
ancora `status="none"` hardcoded (vedi ponytail comment in `DetailScreen.tsx` riga ~206:
"deferred to Phase 4 player wiring"). Per ora usare sempre `playArrow`. NON cablare il
progresso: è fuori scope (vedi T-D4).
**Verifica**: in focus su una card episodio appare l'icona play bianca al centro dello still;
fuori focus sparisce.

### T-D4 — [DEFERITO] Progress bar + stato "Visto"/orario sull'episodio
**Stato**: NON eseguire. Bloccato da Phase 4 (wiring progresso player), come già annotato nel
codice (`DetailScreen.tsx` passa `status="none"`). Android mostra progress bar + "Visto"/
`m:ss / m:ss`. Va fatto insieme al collegamento del progresso reale, non in questo giro stili.
Lasciato qui solo per tracciamento.

---

## FASE E — Card "Altro" (load-more nei rail)

Riferimento Android: `TvSectionRow.kt` → `TvLoadMoreCard` (righe 90-148).
vidaaos: `src/components/ImmersiveRow.tsx` (il `Focusable` con `className="altro-card"`) +
CSS `.altro-card`.

### T-E1 — Sfondo bianco semi-trasparente (non surface-3)
**File**: `src/styles.css`, `.altro-card` (righe ~604-616).
Android: `White@0.08` a riposo, `White@0.18` in focus. vidaaos: `var(--surface-3)` (#2a2a2a).
- `background: var(--surface-3);` → `background: rgba(255, 255, 255, 0.08);`
- aggiungere: `.altro-card.f-focus { background: rgba(255, 255, 255, 0.18); }`
**Verifica**: card "Altro" con velo bianco tenue; più chiara in focus.

### T-E2 — Icona freccia sopra la label
**File**: `src/components/ImmersiveRow.tsx`.
Android mostra `Icons.Filled.ArrowForward` sopra la scritta "Altro". vidaaos mostra solo testo.
**Fix**: aggiungere l'icona freccia. In `Icon.tsx` aggiungere a `ICON_PATHS`:
```ts
arrowForward: 'M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z',
```
In `ImmersiveRow.tsx`, dentro il `Focusable` "Altro", sostituire `<span>{strings.more}</span>`
con:
```tsx
<>
  <InlineIcon path={ICON_PATHS.arrowForward} size={24} />
  <span>{strings.more}</span>
</>
```
Import: `import { InlineIcon, ICON_PATHS } from './Icon';`
E rendere `.altro-card` una colonna centrata (icona sopra, testo sotto):
```css
.altro-card {
  flex-direction: column;
  gap: 8px;
}
```
(aggiungere `display:flex` è già presente; assicurarsi resti `align-items:center; justify-content:center`).
**Verifica**: la card "Altro" mostra una freccia → sopra la parola "Altro", centrate.

### T-E3 — Allineamento baseline con le card vicine
**File**: `src/components/ImmersiveRow.tsx`.
**Problema**: le MediaCard hanno poster + label sotto; la card "Altro" ha solo il riquadro →
il suo bordo inferiore è più in alto (disallineata). Android aggiunge una label vuota sotto la
card Altro per pareggiare la baseline (TvLoadMoreCard righe 142-146).
**Fix**: avvolgere la card Altro in un `.card-focus`-like con una label vuota sotto, OPPURE più
semplice: dare al `Focusable` "Altro" `className="card-focus"` e mettere dentro il riquadro
`.altro-card` + una `<div class="card-label"> </div>` vuota. Struttura target:
```tsx
<Focusable scale={1.05} frame onSelect={onMore} onArrowPress={(d) => d !== 'right'} className="card-focus">
  <div class="altro-card">
    <InlineIcon path={ICON_PATHS.arrowForward} size={24} />
    <span>{strings.more}</span>
  </div>
  <div class="card-label">&nbsp;</div>
</Focusable>
```
Adeguare CSS: `.altro-card` diventa il riquadro interno (width 140px, aspect 2/3), niente più
`flex:0 0 auto` sul wrapper (lo dà `.card-focus`). L'anello di focus va sul riquadro:
```css
.card-focus.f-focus .altro-card {
  box-shadow: 0 0 0 3px var(--focus-ring);
}
```
(coerente con T-A0). Rimuovere `frame` dal Focusable se ora l'anello lo disegna il CSS del
riquadro, per evitare doppio anello — tenerne UNO solo.
**Verifica**: il bordo inferiore della card "Altro" è allineato ai poster delle card accanto;
un solo anello bianco in focus.

---

## FASE F — Rifiniture minori (bassa priorità)

### T-F1 — Dimensione titoli sezione a 16px (DECISO: replica fedele)
**File**: `src/styles.css`, `.rail-title` (righe ~194-202).
Android `TvSectionTitle` usa `typography.titleMedium` = **16sp / peso Medium (500)**. vidaaos
`.rail-title` = `20px / 600`. Per la parità richiesta si allinea ad Android (vale sia Home sia
Detail — Android usa titleMedium in entrambe).
- `font-size: 20px;` → `font-size: 16px;`
- `font-weight: 600;` → `font-weight: 500;`
Il badge icona 30px resta invariato: la proporzione badge/testo diventa identica ad Android.
**Verifica**: i titoli delle rail ("Popolari", "Continua a guardare", "Episodi", "Ti potrebbe
piacere") sono a 16px accanto al badge 30px.

### T-F2 — Font-family
Android usa `FontFamily.Default` (sans di sistema). vidaaos usa `'Roboto', 'Helvetica Neue',
Arial, sans-serif`. Su VIDAA Roboto probabilmente non è installato → fallback sans di sistema,
già equivalente all'Android. **Nessuna azione**, solo nota.

---

## FASE G — Griglie Search + SectionList (densità colonne — PRIORITÀ ALTA)

Riferimento Android: `TvSearchScreen.kt` riga 157 e `TvSectionListScreen.kt` riga 103 →
**entrambe** usano `GridCells.Fixed(5)` (esattamente 5 colonne), spacing 14dp.

### T-G1 — Griglia a 5 colonne fisse
**File**: `src/styles.css`, `.grid-5` (righe ~324-333).
**Problema**: vidaaos usa `repeat(auto-fill, minmax(180px, 1fr))` → su un TV 1080p vengono
**9-10 colonnine** invece delle **5 colonne grandi** di Android. È la divergenza visiva più
marcata di Search e SectionList. Il commento sopra `.grid-5` ("matches Android
GridCells.Adaptive") è **errato**: l'Android usa `Fixed(5)`.
ATTUALE:
```css
.grid-5 {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 18px 14px;
  padding: 24px var(--rail-h-pad);
}
```
TARGET (aggiornare anche il commento sopra, che è sbagliato):
```css
/* Android GridCells.Fixed(5): esattamente 5 colonne, spacing 14dp (TvSearchScreen /
   TvSectionListScreen). Le card riempiono la cella (grid-5 .card-poster width:100%). */
.grid-5 {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 14px;
  padding: 16px var(--rail-h-pad);
}
```
La regola `.grid-5 .card-poster, .grid-5 .card-label { width: 100% }` (righe ~338-341) resta
invariata: fa sì che i poster riempiano la cella 1/5 (diventando grandi come su Android).
**Verifica**: Search e SectionList mostrano **5 poster per riga**, grandi; non più ~9-10
piccoli. Ridimensionando il drawer i poster si adattano (1fr) senza overflow orizzontale.

---

## FASE H — Search: chip filtro e righe recenti

Riferimento Android: `TvSearchScreen.kt` (TvFilterChip righe 434-470, righe cronologia 137-152).

### T-H1 — Chip filtro "riempiti" (filled pill), non outline
**File**: `src/styles.css`, `.filter-chip` (righe ~838-854).
**Problema**: Android usa pill **riempite** (TvFilterChip): default `White@0.08` + bordo
`White@0.12` testo bianco; selezionata `primary` + `onPrimary`; in focus resta `White@0.18`
(sottile) + anello (NON bianco pieno come le chip stagione). vidaaos usa pill outline
(selezionata = testo+bordo primary trasparente).
TARGET (sostituire l'intero blocco `.filter-chip` + `.filter-chip.selected`):
```css
.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  padding: 8px 18px;
  border-radius: 999px;
  color: var(--on-surface);
  font-size: 14px;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
}
/* selezionato: primary pieno; deve vincere sul fill di focus (specificità) */
.filter-chip.selected,
.filter-chip.selected.f-focus.fill {
  background: var(--primary);
  color: var(--primary-on);
  border-color: transparent;
}
```
Il focus di una chip NON selezionata usa già il generico `.focusable.f-focus.fill`
(`White@0.12`) + `.ring` (anello): equivale al `White@0.18` + anello di Android. Non aggiungere
un `.filter-chip.f-focus.fill` bianco/nero (sarebbe troppo, quello è per le chip stagione).
**Verifica**: le 3 chip tipo ("Tutti/Film/Serie TV") + Ordina + Filtri hanno riempimento grigio;
quella selezionata è primary piena; in focus si schiariscono leggermente con anello bianco.

### T-H2 — Righe "Ricerche recenti" senza bordo permanente
**File**: `src/styles.css`, `.recent-row` (righe ~863-869).
Android: nessun bordo, solo sfondo in focus. vidaaos ha `border: 1px solid rgba(255,255,255,0.06)`.
TARGET: rimuovere la riga `border: ...` da `.recent-row` (il focus resta gestito da `ring`+`fill`).
**Verifica**: le righe recenti non hanno più il rettangolo di bordo a riposo; il riquadro
compare solo in focus.

> **Nota (bassa priorità, nessuna azione richiesta)**: Android Search usa padding orizzontale
> 48dp, vidaaos `.search-bar`/grid usano 32px (`--rail-h-pad`). Differenza di 16px; l'Android è
> incoerente al suo interno (SectionList usa 32dp). Si lascia 32px per coerenza globale.

---

## FASE I — Library: nascondere le righe vuote

Riferimento Android: `TvLibraryScreen.kt` — ogni riga è resa **solo se non vuota**
(`if (continueWatching.isNotEmpty())` ecc.). vidaaos rende sempre tutte e 3 le righe, mostrando
un placeholder `empty`/`emptyLabel` per quelle vuote.

### T-I1 — Rendere solo le righe con contenuto
**File**: `src/screens/LibraryScreen.tsx` (righe ~100-161).
**Fix**: avvolgere ciascuna delle tre `ImmersiveRow` in un guard di lunghezza e togliere le
prop `empty`/`emptyLabel`. Esempio per la prima:
ATTUALE:
```tsx
<ImmersiveRow
  title={strings.continueWatching}
  icon={SECTION_ICONS.continueWatching}
  focusKey="lib-cw"
  empty={cw.length === 0}
  emptyLabel={strings.continueWatching}
>
  {cw.map((e) => ( ... ))}
</ImmersiveRow>
```
TARGET:
```tsx
{cw.length > 0 && (
  <ImmersiveRow
    title={strings.continueWatching}
    icon={SECTION_ICONS.continueWatching}
    focusKey="lib-cw"
  >
    {cw.map((e) => ( ... ))}
  </ImmersiveRow>
)}
```
Fare lo stesso per `wl` (`lib-wl`) e `hist` (`lib-hist`). Il caso "tutto vuoto" è già gestito
dallo stub `allEmpty` a inizio componente — non toccarlo.
**Verifica**: se solo "Continua a guardare" ha contenuto, la schermata mostra **una sola riga**,
non tre con placeholder vuoti; con libreria vuota resta lo stub centrale.

> **Nota**: il padding orizzontale rail della Library resta 32px (come Home). Android usa 16dp,
> ma vidaaos ha scelto 32 globalmente (coerenza con Home). Nessuna azione.

---

## FASE J — Settings: layout e intestazioni

Riferimento Android: `TvSettingsScreen.kt`.

### T-J1 — Layout full-width (togliere la colonna centrata 720px)
**File**: `src/styles.css`, `.settings-scroll` (righe ~1046-1050).
**Problema**: Android rende le impostazioni **a tutta larghezza** con padding laterale 48dp
(le righe occupano tutta la larghezza, label a sinistra e valore a destra). vidaaos **centra**
una colonna stretta `max-width: 720px` (`margin: 0 auto`). È una differenza di posizionamento.
ATTUALE:
```css
.settings-scroll {
  max-width: 720px;
  margin: 0 auto;
  padding: 32px var(--rail-h-pad) 64px;
}
```
TARGET:
```css
.settings-scroll {
  padding: 24px 48px 64px;
}
```
**Verifica**: le righe impostazioni si estendono per tutta la larghezza dello schermo (con 48px
di margine laterale); il valore a destra è allineato al bordo destro, non centrato in una
colonna stretta.

### T-J2 — Intestazioni di sezione: niente maiuscolo/spaziatura
**File**: `src/styles.css`, `.settings-section-header` (righe ~1065-1072).
**Problema**: Android usa `titleMedium` (16sp, peso Medium) colore primary, **testo normale**.
vidaaos lo rende **MAIUSCOLO** con `letter-spacing` e peso 700.
ATTUALE:
```css
.settings-section-header {
  margin: 24px 0 10px;
  font-size: 16px;
  font-weight: 700;
  color: var(--primary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
```
TARGET:
```css
.settings-section-header {
  margin: 24px 0 10px;
  font-size: 16px;
  font-weight: 500;
  color: var(--primary);
}
```
**Verifica**: i titoli sezione ("Riproduzione", "Rete e privacy"…) sono in caso normale
(non maiuscolo), color primary, senza spaziatura extra tra le lettere.

### T-J3 — Titolo "Impostazioni" a 20px (headlineMedium)
**File**: `src/styles.css`, `.settings-title` (righe ~1052-1056).
Android `headlineMedium` (Type.kt) = **20sp / SemiBold**. vidaaos = `28px / 700`.
- `font-size: 28px;` → `font-size: 20px;`
- `font-weight: 700;` → `font-weight: 600;`
**Verifica**: il titolo "Impostazioni" è a 20px, poco più grande dei titoli sezione (16px),
come su Android.

### T-J4 — Font righe impostazioni (minore)
**File**: `src/styles.css`.
Android: label `bodyLarge` = 16sp, valore `bodyMedium` = 14sp. vidaaos: `.settings-row` 17px,
`.settings-row .row-value` 15px.
- `.settings-row` (riga ~1082): `font-size: 17px;` → `16px;`
- `.settings-row .row-value` (riga ~1094): `font-size: 15px;` → `14px;`
**Verifica**: righe a 16px, valore a 14px.

> **Nota (opzionale, richiede asset)**: Android Settings mostra il **logo TMDB** (immagine
> 200×16dp) sopra il testo di attribuzione; vidaaos mostra solo il testo `.tmdb-attribution`.
> Aggiungere il logo richiede portare l'asset `tmdb_logo` come immagine/SVG inline. Fuori dallo
> scope stili puro; farlo solo se l'asset è disponibile. La sezione **Backup** presente in
> vidaaos e assente su Android TV è una feature aggiuntiva intenzionale: **lasciarla**.

---

## FASE K — Player (controlli)

Riferimento Android: `ui/tv/player/TvPlayerScreen.kt`.
vidaaos: `src/player/ControlsOverlay.tsx` + CSS `.player-*`, `.circle-btn`, `.seekbar`,
`.next-pill`, `.warp-badge`.

> La struttura del player (due modalità D-pad, scrub dal root key-handler, overlay controlli
> con scrim `black@0.45`, settings come drawer a destra) è **già** un mirror fedele di Android.
> Le divergenze sono nello **stile dei controlli**. L'overlay Settings (`.settings-overlay`/
> `.settings-card`, drawer a destra) è già allineato: nessuna azione.

### T-K1 — Bottoni circolari: focus bianco pieno + icona nera + scala (PRIORITÀ ALTA)
**File**: `src/styles.css` + `src/player/ControlsOverlay.tsx`
**Problema**: Android `TvCircleButton` a fuoco diventa un **cerchio bianco pieno con icona nera**
e scala **1.12** (righe 1078-1094); a riposo sfondo `Black@0.4`. vidaaos `.circle-btn` a riposo
`White@0.08` e a fuoco solo `White@0.12` + anello (icona resta bianca, nessuna scala) → poco
leggibile a 3 metri.
**Fix CSS** — `.circle-btn` (righe ~419-428):
ATTUALE:
```css
.circle-btn {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}
```
TARGET:
```css
.circle-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}
/* a fuoco: cerchio bianco pieno, icona nera (vince sul .focusable.f-focus.fill generico) */
.circle-btn.f-focus.fill {
  background: #fff;
  color: #000;
}
```
(le varianti `.circle-btn.md` 64px e `.circle-btn.lg` 88px restano invariate: il 44px vale solo
per i bottoni top-bar CC/Impostazioni, come Android 44dp.)
**Fix TSX** — in `ControlsOverlay.tsx` aggiungere `scale={1.12}` a **tutti** i 5 `Focusable` con
`className="circle-btn…"` (pl-cc, pl-settings, pl-prev, pl-play/pl-replay, pl-next). La scala usa
il meccanismo esistente (`--scale` var), l'anello resta da `ring`, il colore dal CSS sopra.
**Verifica**: a fuoco ogni bottone di trasporto diventa un cerchio bianco pieno con icona nera e
cresce leggermente; a riposo cerchio scuro con icona bianca.

### T-K2 — Dimensione icone per bottone (play grande, prev/next medie)
**File**: `src/player/ControlsOverlay.tsx`
**Problema**: l'helper `svg()` (righe 12-16) forza `width/height 28` per **tutte** le icone →
il tasto play (88px) ha un'icona minuscola. Android usa 48dp (play/replay), 38dp (prev/next),
~28dp (top-bar).
**Fix**: rendere `svg()` parametrico:
```tsx
const svg = (d: string, size = 28): VNode => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
    <path d={d} />
  </svg>
);
```
Poi passare le dimensioni: play/pausa e replay → `svg(PLAY, 48)` / `svg(PAUSE, 48)` /
`svg(REPLAY, 48)`; prev/next → `svg(PREV, 38)` / `svg(NEXT, 38)`; CC e Settings restano
`svg(CC)` / `svg(GEAR)` (28).
**Verifica**: l'icona play riempie il cerchio da 88px; prev/next intermedie; top-bar piccole.

### T-K3 — Pill "Prossimo episodio": stile Android
**File**: `src/styles.css` + `src/player/ControlsOverlay.tsx`
**Problema**: Android rende la pill con fondo `Black@0.65`, bordo `White@0.25`, testo bianco 14sp
+ icona SkipNext; a fuoco diventa **bianca con testo/icona neri** (righe 838-865). vidaaos
`.next-pill` è **primary pieno**, senza bordo né icona.
**Fix CSS** — `.next-pill` (righe ~985-995):
```css
.next-pill {
  position: absolute;
  top: -34px;
  right: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  padding: 10px 18px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.25);
}
.next-pill.f-focus.fill {
  background: #fff;
  color: #000;
  border-color: transparent;
}
```
**Fix TSX** — nella pill (righe ~100-110) avvolgere il testo e aggiungere l'icona:
`{strings.nextEpisode}` → `<span>{strings.nextEpisode}</span>{svg(NEXT, 20)}`.
**Verifica**: pill scura con bordo, testo + icona freccia; a fuoco bianca con testo/icona neri.

### T-K4 — Badge WARP: testo attenuato + icona lucchetto (minore)
**File**: `src/styles.css` + `src/player/ControlsOverlay.tsx`
**Problema**: Android rende il badge con testo `White@0.7` + icona Lock, pill (righe 1039-1056).
vidaaos `.warp-badge` è **primary**, senza icona, raggio 8.
**Fix CSS** — `.warp-badge` (righe ~973-983):
```css
.warp-badge {
  position: absolute;
  top: -28px;
  left: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(0, 0, 0, 0.55);
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
  font-weight: 500;
  padding: 8px 14px;
  border-radius: 999px;
}
```
**Fix TSX** — aggiungere il glifo Lock. In `ControlsOverlay.tsx` definire la path:
```tsx
const LOCK = 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z';
```
e cambiare `<div class="warp-badge">{strings.warpActive}</div>` in:
```tsx
<div class="warp-badge">{svg(LOCK, 16)}<span>{strings.warpActive}</span></div>
```
**Verifica**: badge scuro a pillola con lucchetto + testo grigio chiaro, non più color primary.

### T-K5 — Seekbar: rifiniture (minore)
**File**: `src/styles.css`, `.seekbar` (righe ~440-446) e `.time-labels` (righe ~472-477).
Android: traccia `White@0.3`, altezza 4dp (6dp a fuoco), pallino 9dp (=18px) solo a fuoco,
tempi 13sp. vidaaos: traccia `White@0.2`, altezza fissa 6px, pallino 14px, tempi 14px.
- `.seekbar` `background: rgba(255, 255, 255, 0.2);` → `rgba(255, 255, 255, 0.3);`
- `.seekbar` `height: 6px;` → `height: 4px;` e aggiungere `.seekbar.focused { height: 6px; }`
- `.seekbar > .thumb` (righe ~457-466): `width: 14px; height: 14px;` → `width: 18px; height: 18px;`
- `.time-labels` `font-size: 14px;` → `13px;`
**Nota (opzionale)**: Android mostra anche la barra **buffered** (`White@0.55`); vidaaos non
traccia il buffered → lasciare stare finché non c'è il segnale. Nessuna azione.
**Verifica**: traccia leggermente più chiara, si ispessisce a fuoco, pallino più grande.

### T-K6 — Sottotitolo top-bar (minore)
**File**: `src/styles.css`, `.player-sub` (righe ~395-399).
Android: 14sp `White@0.6`. vidaaos: 16px `on-surface-variant`.
- `font-size: 16px;` → `14px;`
- `color: var(--on-surface-variant);` → `color: rgba(255, 255, 255, 0.6);`
**Verifica**: la riga "S1 E1 - Titolo" sotto al titolo è a 14px, bianca al 60%.

### T-K7 — [DEFERITO/OPZIONALE] Indicatore "±N secondi" durante lo scrub
**Stato**: opzionale, richiede una piccola aggiunta di stato (non solo CSS).
Android mostra, mentre si scorre la timeline, una bolla centrale (offset −120px) `Black@0.55`
con icona FastForward/FastRewind + "+N"/"−N" secondi (TvSkipIndicator, righe 1100-1118). vidaaos
non la mostra. Per aggiungerla serve esporre l'**ancora di scrub** (posizione a inizio pressione)
da `Scrubber`/`PlayerStore`, così da calcolare il delta `pendingSeekMs − ancora` arrotondato a
blocchi da 10s. È logica del player, fuori dallo scope stili puro: farlo insieme al proprietario
del player o rimandarlo. Markup di riferimento (dentro `.player-controls`, mostrato solo se
`scrubbing`):
```tsx
{PlayerStore.scrubbing.value && (
  <div class="skip-indicator">{svg(deltaSec < 0 ? REWIND : FFWD, 22)}<span>{deltaSec < 0 ? deltaSec : `+${deltaSec}`}</span></div>
)}
```
con CSS `.skip-indicator { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) translateY(-120px); display:inline-flex; align-items:center; gap:8px; background:rgba(0,0,0,0.55); color:#fff; font-size:15px; font-weight:500; padding:10px 18px; border-radius:999px; }`.
**Non eseguire** finché l'ancora di scrub non è disponibile.

---

## Ordine di esecuzione consigliato

1. **T-A0** (focus ring box-shadow) — tocca tutte le card, va prima.
2. **T-A1, T-A2, T-A3** (card base).
3. **T-B1, T-B2, T-B3** (progress card).
4. **T-C0** (ristrutturazione layout Detail — PRIMA di tutti gli altri task Detail), poi
   **T-C1, T-C2, T-C3, T-C4, T-C5, T-C6** (dettaglio: colori/chip/cast).
5. **T-D1, T-D2, T-D3** (episodi; D4 deferito).
6. **T-E1, T-E2, T-E3** (card Altro).
7. **T-F1** (titoli 16px). **T-F2** solo nota, nessuna azione.
8. **T-G1** (griglia 5 colonne — Search + SectionList).
9. **T-H1, T-H2** (Search: chip filtro filled, righe recenti).
10. **T-I1** (Library: nascondi righe vuote).
11. **T-J1, T-J2, T-J3, T-J4** (Settings: layout + intestazioni).
12. **T-K1** (bottoni circolari focus — player, alta priorità), poi **T-K2, T-K3, T-K4, T-K5,
    T-K6** (player: icone, pill, badge, seekbar, sottotitolo). **T-K7** deferito/opzionale.

Le decisioni aperte sono state chiuse: **T-C6 = cast su riga singola** (fedele Android),
**T-F1 = titoli sezione 16px** (fedele Android). Non restano `[DECISIONE]` da confermare;
restano deferiti **T-D4** (progresso episodi, Phase 4) e **T-K7** (indicatore scrub, richiede
l'ancora di scrub dal player).

Copertura schermate: Home (Fasi A/B/E/F), Dettaglio (Fasi A/C/D), Search + SectionList
(Fasi A/G/H), Library (Fasi A/B/I), Settings (Fase J), Player (Fase K). CacheManagement non
incluso (non richiesto).

Dopo ogni fase: `npm run build`. Al termine, verifica visiva su emulatore VIDAA di Home,
Dettaglio film, Dettaglio serie (con stagioni/episodi), rail "Continua a guardare".

## Fuori scope (NON toccare)
- Logica focus/navigazione Norigin (`src/spatial/*`), store (`src/state/*`), data/provider,
  player (`src/player/*`), proxy (`vidaaos-proxy/*`).
- Wiring progresso episodi (Phase 4) → blocca T-D4.
- Token surfaces/scrim/drawer/primary: già allineati, non modificare.
