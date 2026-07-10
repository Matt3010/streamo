// Port of SettingsDataStore.kt. @preact/signals backed by localStorage.
// Keys mirror the Kotlin preference keys. Download-quality and renderer-protocol
// prefs are dropped (downloads + casting are out of scope for the web port).
import { signal, type Signal } from '@preact/signals';

const LS_PREFIX = 'streamo.';

// Default TMDB key is baked into the Android build; web port has no BuildConfig,
// so the default is empty and the user must set it in Settings.
const DEFAULT_TMDB_API_KEY = '';

function read<T>(key: string, fallback: T, parse: (raw: string) => T): T {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (raw == null) return fallback;
    return parse(raw);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable on locked-down/legacy TV browsers. Keep the
    // in-memory setting usable for the current session.
  }
}

function persistedSignal<T>(key: string, fallback: T, parse: (raw: string) => T): Signal<T> {
  const s = signal(read(key, fallback, parse));
  return new Proxy(s, {
    get(target, prop) {
      if (prop === 'value') return target.value;
      if (prop === 'set') return (v: T) => {
        target.value = v;
        write(key, v);
      };
      return Reflect.get(target, prop, target);
    },
    set(target, prop, value) {
      if (prop === 'value') {
        target.value = value as T;
        write(key, value);
        return true;
      }
      return Reflect.set(target, prop, value, target);
    },
  }) as unknown as Signal<T>;
}

function boolSig(key: string, fallback: boolean): Signal<boolean> {
  return persistedSignal(key, fallback, (r) => r === 'true');
}

function stringSig(key: string, fallback: string): Signal<string> {
  return persistedSignal(key, fallback, (raw) => {
    // Current values are JSON strings. Accept legacy/manual raw values too so
    // an already configured key is not lost during the migration.
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'string' ? parsed : fallback;
    } catch {
      return raw;
    }
  });
}

// Accent: stored as three floats 0..1 (mirrors accent_r/g/b in Kotlin).
function accentSig(): Signal<{ r: number; g: number; b: number }> {
  const defaultAccent = { r: 0.898, g: 0.035, b: 0.078 };
  const parse = (raw: string) => {
    const v = JSON.parse(raw);
    return { r: Number(v.r ?? defaultAccent.r), g: Number(v.g ?? defaultAccent.g), b: Number(v.b ?? defaultAccent.b) };
  };
  return persistedSignal('accent', defaultAccent, parse);
}

export const settings = {
  apiKey: stringSig('tmdb_api_key', DEFAULT_TMDB_API_KEY),
  providerLocale: stringSig('provider_locale', 'it'),
  showCardInfo: boolSig('show_card_info', true),
  reduceEffects: boolSig('reduce_effects', false),
  autoDeleteWatched: boolSig('auto_delete_watched_downloads', false),
  accent: accentSig(),
  streamingQualityWifi: stringSig('streaming_quality_wifi', 'auto'),
  streamingQualityMobile: stringSig('streaming_quality_mobile', 'auto'),
  warpEnabled: boolSig('warp_enabled', false),
  searchSortField: stringSig('search_sort_field', 'POPULARITY'),
  searchSortOrder: stringSig('search_sort_order', 'DESC'),
  animeUnityBaseUrl: stringSig('animeunity_base_url', 'https://www.animeunity.so'),
  tmdbCacheEnabled: boolSig('tmdb_cache_enabled', true),

  setSearchSort(field: string, order: string): void {
    settings.searchSortField.value = field;
    settings.searchSortOrder.value = order;
  },
  setAccentColor(r: number, g: number, b: number): void {
    settings.accent.value = { r, g, b };
  },
};
