// Positional focus memory + recovery helpers built on the Norigin core.
// The core exports getCurrentFocusKey / doesFocusableExist / setFocus as named
// functions (see node_modules/@noriginmedia/norigin-spatial-navigation-core).
import {
  getCurrentFocusKey,
  doesFocusableExist,
  setFocus
} from '@noriginmedia/norigin-spatial-navigation-core';

// Ricorda l'ultimo focusKey per chiave di rotta (routeToPath(route)), così il
// Back ripristina la posizione invece di saltare alla prima card. Module-level:
// sopravvive allo smontaggio della schermata, si azzera solo al reload (ok per
// una sessione TV).
const lastFocusByRoute = new Map<string, string>();

// Chiamare PRIMA di lasciare una rotta (in navigate/popstate), con la chiave
// della rotta uscente. Registra la card attualmente focalizzata — ma non se il
// focus era nella Drawer: la Drawer resta montata su ogni rotta (app.tsx), e
// navigare da lì (il modo primario di navigare) altrimenti sovrascriverebbe la
// posizione di contenuto ricordata con "drawer-<voce>" a ogni click.
export function rememberFocus(routeKey: string): void {
  const key = getCurrentFocusKey();
  if (key && !key.startsWith('drawer')) lastFocusByRoute.set(routeKey, key);
}

// Ripristina il focus su (memorizzato ?? fallback). Ritenta per rAF finché il
// target è registrato (le card TMDB montano async). Se il target ricordato non
// compare entro il cap (es. era in pagina 3 non ancora ricaricata) ripiega sul
// fallback. Ritorna una funzione di cancel per la cleanup dell'effect.
export function restoreFocus(routeKey: string, fallbackKey: string, preferredKey?: string): () => void {
  const target = preferredKey ?? lastFocusByRoute.get(routeKey) ?? fallbackKey;
  let raf = 0;
  let attempts = 0;
  let cancelled = false;
  const tick = () => {
    if (cancelled) return;
    if (doesFocusableExist(target)) {
      void setFocus(target);
      return;
    }
    if (++attempts > 20) {
      if (doesFocusableExist(fallbackKey)) void setFocus(fallbackKey);
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelled = true;
    if (raf) cancelAnimationFrame(raf);
  };
}

// Recupero focus quando l'elemento focalizzato viene smontato (cambio stagione,
// nuova ricerca, filtri). Se il focus corrente esiste ancora NON fa nulla (così
// non ruba il focus mentre l'utente digita); altrimenti sposta il focus sul primo
// fallback disponibile, con breve retry per attendere il render del nuovo set.
// Ritorna una funzione di cancel: il chiamante deve restituirla dal proprio
// effect così il retry non chiama setFocus dopo che lo screen si è smontato.
export function recoverFocus(fallbackKeys: string[]): () => void {
  const cur = getCurrentFocusKey();
  if (cur && doesFocusableExist(cur)) return () => {}; // focus ancora vivo, non toccare
  let raf = 0;
  let attempts = 0;
  let cancelled = false;
  const tick = () => {
    if (cancelled) return;
    for (const k of fallbackKeys) {
      if (doesFocusableExist(k)) {
        void setFocus(k);
        return;
      }
    }
    if (++attempts <= 20) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelled = true;
    if (raf) cancelAnimationFrame(raf);
  };
}
