import { render } from 'preact';
import { effect } from '@preact/signals';
import { App } from './app';
import { settings } from './data/settings';
import { applyAccent } from './util/theme';
import './styles.css';

// Applies the default/persisted accent (Android's brand red by default) and
// keeps it in sync if the user changes it later in Settings.
effect(() => applyAccent(settings.accent.value));

// ponytail: ask the browser/VIDAA to persist IndexedDB so progress/watchlist/
// history survive eviction. Best-effort — the promise may reject on older
// engines; never block startup on it.
try {
  void navigator.storage?.persist?.();
} catch {
  /* ignore */
}

render(<App />, document.getElementById('app')!);