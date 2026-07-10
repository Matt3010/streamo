import { createContext } from 'preact';
import { useContext, useEffect } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { Route, routeToPath, pathToRoute } from './routes';
import { handleBack } from './BackHandler';
import { rememberFocus } from '../spatial/focusMemory';

export interface NavContextValue {
  route: { value: Route };
  navigate: (r: Route) => void;
  goBack: () => void;
}

export const NavContext = createContext<NavContextValue | null>(null);

export function useNav(): NavContextValue {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error('useNav must be used inside Router');
  return ctx;
}

const BACK_CODES = new Set(['Backspace', 'Escape', 'BrowserBack']);

function routeFromLocation(historyState: unknown = window.history.state): Route {
  if (historyState && typeof historyState === 'object' && 'name' in historyState) {
    try {
      const candidate = historyState as Route;
      if (routeToPath(candidate) === window.location.pathname) return candidate;
    } catch {
      // Ignore unrelated/malformed state left by the host browser.
    }
  }
  return pathToRoute(window.location.pathname);
}

export function Router({ children }: { children: ComponentChildren }) {
  const route = useSignal<Route>(routeFromLocation());

  const navigate = (r: Route) => {
    const path = routeToPath(r);
    if (path === window.location.pathname) return;
    rememberFocus(routeToPath(route.value)); // rotta uscente
    window.history.pushState(r, '', path);
    route.value = r;
  };

  const goBack = () => {
    if (window.history.length > 1) window.history.back();
  };

  useEffect(() => {
    // Give the initial entry typed state as well. PlayerStore may enrich it
    // later with title/poster/date recovered from TMDB.
    window.history.replaceState(route.value, '', window.location.href);

    const onPop = (event: PopStateEvent) => {
      rememberFocus(routeToPath(route.value)); // rotta uscente, prima del back
      route.value = routeFromLocation(event.state);
    };
    const onKey = (e: KeyboardEvent) => {
      // Let focused text fields receive Backspace; VIDAA can map its keyboard's
      // delete key to the same code used for app navigation.
      if (
        e.code === 'Backspace' &&
        (document.activeElement instanceof HTMLInputElement ||
          document.activeElement instanceof HTMLTextAreaElement ||
          (document.activeElement as HTMLElement | null)?.isContentEditable)
      ) return;
      if (BACK_CODES.has(e.code)) {
        // Escape also used by overlays; let BackHandler decide.
        if (handleBack()) {
          e.preventDefault();
          e.stopPropagation();
        } else if (e.code !== 'Escape') {
          // Backspace/BrowserBack with no overlay -> history back.
          e.preventDefault();
          goBack();
        }
      }
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey, true); // capture: run before spatial nav
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  return (
    <NavContext.Provider value={{ route, navigate, goBack }}>{children}</NavContext.Provider>
  );
}
