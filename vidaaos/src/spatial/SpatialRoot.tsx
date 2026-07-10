import { useEffect } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import {
  init,
  destroy,
  setFocus,
  ROOT_FOCUS_KEY
} from '@noriginmedia/norigin-spatial-navigation-core';
import { FocusContext } from './FocusContext';

// Initializes the Norigin spatial-navigation singleton once, provides the
// root focus context (ROOT_FOCUS_KEY) so top-level focusables register under
// root, and boots focus. The default web adapter binds keydown on window.
export function SpatialRoot({ children }: { children: ComponentChildren }) {
  useEffect(() => {
    init({
      debug: false,
      shouldFocusDOMNode: false,
      // ponytail: geometria viewport-relative (getBoundingClientRect) invece di
      // offset-based. La nav verticale confronta allora la colonna A SCHERMO
      // (viewport x), non l'index assoluto: da una card al centro di un rail
      // scrollo giù su un rail mai toccato (scroll 0) e atterra sulla card già
      // visibile alla stessa colonna, non sulla card #N uguale per index (che
      // sarebbe off-screen e forzerebbe uno scroll di scatto del rail intatto —
      // "stesso index di quelli visibili" richiesto). La nav orizzontale resta
      // corretta: l'ORDINE relativo dei sibling non cambia con lo scroll, quindi
      // la card adiacente vince sempre (isAdjacentSlice + asse primario x).
      // Sicuro vs layout stale: il core invalida layoutUpdated di TUTTI i
      // componenti a ogni smartNavigate (index.mjs:770-773) → re-measure fresco
      // a ogni keypress. Lo scale focus (1.05) sposta i bordi ~4px: trascurabile
      // per la selezione (gap card 14px) e non tocca la calc del carousel
      // (offsetLeft stabile in scrollFocusedIntoView).
      useGetBoundingClientRect: true,
      throttle: 0
    });
    // Boot focus to root after children register. Double-rAF ensures the
    // first screen + drawer have mounted their focusables.
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        void setFocus(ROOT_FOCUS_KEY);
      })
    );
    return () => {
      cancelAnimationFrame(id);
      destroy();
    };
  }, []);

  return <FocusContext.Provider value={ROOT_FOCUS_KEY}>{children}</FocusContext.Provider>;
}

// Exposed for overlays/player to pause/resume D-pad nav.
export { pause as pauseSpatial, resume as resumeSpatial } from '@noriginmedia/norigin-spatial-navigation-core';