import { useEffect, useMemo, useRef } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import {
  SpatialNavigation,
  type FocusDetails,
  type FocusableComponentLayout,
  type KeyPressDetails
} from '@noriginmedia/norigin-spatial-navigation-core';
import { useFocusContext } from './useFocusContext';

let focusIdSeq = 0;

export interface UseFocusableConfig {
  focusable?: boolean;
  saveLastFocusedChild?: boolean;
  trackChildren?: boolean;
  autoRestoreFocus?: boolean;
  isFocusBoundary?: boolean;
  focusBoundaryDirections?: ('up' | 'down' | 'left' | 'right')[];
  forceFocus?: boolean;
  focusKey?: string;
  preferredChildFocusKey?: string;
  // TV: when true (default) the focused element is scrolled into view with
  // safe margins. Pass false to opt out, or pass native ScrollIntoViewOptions.
  scrollIntoView?: boolean | ScrollIntoViewOptions;
  onEnterPress?: (details?: KeyPressDetails) => void;
  onEnterRelease?: () => void;
  onArrowPress?: (direction: string, details?: KeyPressDetails) => boolean;
  onArrowRelease?: (direction: string) => void;
  onFocus?: (layout: FocusableComponentLayout, details?: FocusDetails) => void;
  onBlur?: (layout: FocusableComponentLayout, details?: FocusDetails) => void;
}

export interface UseFocusableResult {
  ref: { current: HTMLElement | null };
  focused: { value: boolean };
  hasFocusedChild: { value: boolean };
  focusKey: string;
  focusSelf: (details?: FocusDetails) => void;
}

// ponytail: 'smooth' dà il feel da TV app; se sulla TV reale (GPU debole)
// scatta, riportare a 'auto'. Knob di calibrazione, non rimuovere.
const SCROLL_BEHAVIOR: ScrollBehavior = 'smooth';

// ponytail: top dell'ultimo nodo focalizzato, per distinguere spostamenti
// orizzontali (stesso row → top ≈ uguale) da verticali (row diverso → top diverso).
// Orizzontale = carousel (la card resta all'inset, il rail scorre con ogni step);
// verticale = scorrere solo se la card è fuori visibile, così ogni rail mantiene
// la sua posizione e su/giù non sposta il rail "da solo verso l'inizio".
let lastFocusedTop: number | null = null;

// Scroll every scrollable ancestor so the focused node stays inside the
// viewport with TV-safe margins. Stops climbing when it leaves an overlay so
// the background screen never scrolls behind a modal.
function scrollFocusedIntoView(
  node: HTMLElement,
  opts: ScrollIntoViewOptions | undefined,
  insideOverlay: boolean
) {
  const margin = 32;
  const behavior = opts?.behavior ?? SCROLL_BEHAVIOR;
  // ponytail: px dal top del content entro cui una card focalizzata è considerata
  // "il primo row" della schermata: navigando up verso di essa si scorre a 0 per
  // rivelare l'header sopra (rail-title / search-bar). Senza questo, lo scroll a
  // margin si ferma a scrollTop≈cardTop-margin (>0) e l'header resta tagliato
  // sopra il viewport — "il D-pad non scrolla al massimo, il titolo è tagliato,
  // serve il mouse". Dimensionato per l'header più alto (search-bar ~100px) +
  // offset primo row; alzalo se una nuova schermata ha un header più alto. Sotto
  // questa soglia i row mid-screen mantengono lo scroll a margin (no jump-to-top).
  const TOP_REVEAL_ZONE = 160;
  // ponytail: carousel solo sugli spostamenti orizzontali (stesso row). Confronto
  // il top del nodo con quello del focus precedente; soglia < altezza row (~234)
  // così row diversi sono sempre distinguibili. Primo focus (no last) → guardia
  // (verticale): mostra la card ricordata senza forzare l'inset.
  const nodeTop = node.getBoundingClientRect().top;
  const isHorizontalMove = lastFocusedTop != null && Math.abs(nodeTop - lastFocusedTop) < 80;
  lastFocusedTop = nodeTop;

  let el: HTMLElement | null = node;
  while (el) {
    if (
      el.classList &&
      (el.classList.contains('overlay-scrim') || el.classList.contains('settings-overlay'))
    ) {
      insideOverlay = true;
    }

    const style = window.getComputedStyle(el);
    const canScrollY =
      /^(auto|scroll)$/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
    const canScrollX =
      /^(auto|scroll)$/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1;

    if (canScrollY || canScrollX) {
      const nodeRect = node.getBoundingClientRect();
      const parentRect = el.getBoundingClientRect();

      if (canScrollY) {
        if (nodeRect.bottom > parentRect.bottom - margin) {
          const delta = nodeRect.bottom - parentRect.bottom + margin;
          el.scrollBy({ top: delta, behavior });
        } else if (nodeRect.top < parentRect.top + margin) {
          // ponytail: primo row della schermata → scrollTo 0 per rivelare
          // l'header sopra la card (rail-title/search-bar). Mid-screen: scroll a
          // margin, la card a 32px dal top (l'header sopra è atteso nascosto).
          const cardTopInContent = nodeRect.top - parentRect.top + el.scrollTop;
          if (cardTopInContent < TOP_REVEAL_ZONE) {
            el.scrollTo({ top: 0, behavior });
          } else {
            const delta = nodeRect.top - parentRect.top - margin;
            el.scrollBy({ top: delta, behavior });
          }
        }
      }

      if (canScrollX) {
        // ponytail: centro stabile via offsetLeft (non viewport-relative). Nodo e
        // rail-row condividono l'offsetParent (.screen) → node.offsetLeft -
        // el.offsetLeft = posizione della card nel content del rail, indipendente
        // da scrollLeft. +offsetWidth/2 = centro card; targetLeft = scrollLeft per
        // portare il centro card al centro del rail. scrollTo assoluto su target
        // stabile → no drift col smooth + autorepeat del D-pad (a differenza di
        // scrollBy su getBoundingClientRect, letto mid-animazione). Clampato dal
        // browser agli estremi: prima/ultima card non si centrano, restano al bordo.
        const cardCenterInRail = node.offsetLeft - el.offsetLeft + node.offsetWidth / 2;
        const targetLeft = cardCenterInRail - el.clientWidth / 2;
        if (isHorizontalMove) {
          // ponytail: carousel centrato (stile app Android) — ogni spostamento
          // orizzontale riporta la card al centro del rail, che scorre di una card
          // per step seguendo il movimento (destra E sinistra). Se la card è già
          // centrata scrollTo è no-op. Non ancorare a sinistra: quel ribaltamento
          // laterale ogni move veniva percepito come "scroll a caso".
          el.scrollTo({ left: targetLeft, behavior });
        } else {
          // ponytail: spostamento verticale (su/giù tra righe) — scorrere solo se
          // la card è fuori dal visibile, così ogni rail mantiene la sua posizione
          // e la nav verticale non sposta il rail "da sola verso l'inizio". La card
          // ricordata di ciascun row è già centrata (dal carousel) → visibile → no
          // scroll. Fuori visibile → centra (mostra la card off-screen).
          const cardVisible =
            nodeRect.left >= parentRect.left + margin &&
            nodeRect.right <= parentRect.right - margin;
          if (!cardVisible) el.scrollTo({ left: targetLeft, behavior });
        }
      }

      if (insideOverlay) return;
    }

    el = el.parentElement;
  }
}

export function useFocusable(config: UseFocusableConfig = {}): UseFocusableResult {
  const {
    focusable = true,
    saveLastFocusedChild = true,
    trackChildren = false,
    autoRestoreFocus = true,
    isFocusBoundary = false,
    focusBoundaryDirections,
    forceFocus = false,
    focusKey: propFocusKey,
    preferredChildFocusKey,
    scrollIntoView: scrollIntoViewOpt = true,
    onEnterPress,
    onEnterRelease,
    onArrowPress,
    onArrowRelease,
    onFocus,
    onBlur
  } = config;

  const parentFocusKey = useFocusContext();
  const ref = useRef<HTMLElement | null>(null);
  const focused = useSignal(false);
  const hasFocusedChild = useSignal(false);

  const focusKey = useMemo(
    () => propFocusKey || `sn:focusable-item-${focusIdSeq++}`,
    [propFocusKey]
  );

  const focusSelf = (details: FocusDetails = {}) => {
    SpatialNavigation.setFocus(focusKey, details);
  };

  // Ref to the latest user callbacks so the core always sees fresh closures
  // without re-registering the focusable.
  const cbRef = useRef(config);
  cbRef.current = config;

  // Native scroll options when the user passes an object.
  const nativeScrollOpts =
    typeof scrollIntoViewOpt === 'object' ? scrollIntoViewOpt : undefined;

  const onFocusWrapper = (layout: FocusableComponentLayout, details?: FocusDetails) => {
    if (scrollIntoViewOpt !== false && layout.node) {
      const insideOverlay =
        layout.node.closest('.overlay-scrim, .settings-overlay') != null;
      if (nativeScrollOpts) {
        layout.node.scrollIntoView(nativeScrollOpts);
      } else {
        scrollFocusedIntoView(layout.node, undefined, insideOverlay);
      }
    }
    cbRef.current.onFocus?.(layout, details);
  };

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let attempts = 0;
    const register = () => {
      if (cancelled) return;
      const node = ref.current as HTMLElement | null;
      // ponytail: Preact can run this effect before the ref is attached when the
      // Focusable mounts inside a signal-driven re-render (e.g. the continue-
      // watching row appearing once HomeStore.load resolves). Registering with a
      // null node makes the core store an empty layout, focus lands in the void,
      // and the whole screen goes dead — "first load works, then it breaks". Wait
      // a frame for the node, then register. Cap so a never-mounted node can't
      // spin forever.
      if (!node) {
        if (++attempts > 30) return;
        rafId = requestAnimationFrame(register);
        return;
      }
      SpatialNavigation.addFocusable({
        focusKey,
        node,
        parentFocusKey,
        preferredChildFocusKey,
        onEnterPress: (d?: KeyPressDetails) => cbRef.current.onEnterPress?.(d),
        onEnterRelease: () => cbRef.current.onEnterRelease?.(),
        onArrowPress: (dir: string, d: KeyPressDetails) =>
          cbRef.current.onArrowPress ? cbRef.current.onArrowPress(dir, d) : true,
        onArrowRelease: (dir: string) => cbRef.current.onArrowRelease?.(dir),
        onFocus: onFocusWrapper,
        onBlur: (l: FocusableComponentLayout, d: FocusDetails) => cbRef.current.onBlur?.(l, d),
        onUpdateFocus: (isFocused = false) => {
          focused.value = isFocused;
        },
        onUpdateHasFocusedChild: (isFocused = false) => {
          hasFocusedChild.value = isFocused;
        },
        saveLastFocusedChild,
        trackChildren,
        isFocusBoundary,
        focusBoundaryDirections,
        autoRestoreFocus,
        forceFocus,
        focusable
      });
      if (forceFocus) {
        void SpatialNavigation.setFocus(focusKey);
      }
    };
    register();
    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      SpatialNavigation.removeFocusable({ focusKey });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    SpatialNavigation.updateFocusable(focusKey, {
      node: ref.current as HTMLElement,
      preferredChildFocusKey,
      focusable,
      isFocusBoundary,
      focusBoundaryDirections,
      onEnterPress: (d?: KeyPressDetails) => cbRef.current.onEnterPress?.(d),
      onEnterRelease: () => cbRef.current.onEnterRelease?.(),
      onArrowPress: (dir: string, d?: KeyPressDetails) =>
        cbRef.current.onArrowPress ? cbRef.current.onArrowPress(dir, d) : true,
      onArrowRelease: (dir: string) => cbRef.current.onArrowRelease?.(dir),
      onFocus: onFocusWrapper,
      onBlur: (l: FocusableComponentLayout, d?: FocusDetails) => cbRef.current.onBlur?.(l, d)
    });
  }, [focusKey, preferredChildFocusKey, focusable, isFocusBoundary, focusBoundaryDirections]);

  return { ref, focused, hasFocusedChild, focusKey, focusSelf };
}
