// Thin wrapper around the Hisense VIDAA JS bridge (`window.Hisense_*`).
// These globals are injected by the native VIDAA shell and may not exist at
// all (desktop browser, other TV OS, older firmware) — every call is
// feature-detected and swallowed, never assumed.
declare global {
  interface Window {
    Hisense_enableVKB?: () => void;
  }
}

export function enableVirtualKeyboard(): void {
  try {
    window.Hisense_enableVKB?.();
  } catch {
    // ponytail: no VIDAA bridge on this runtime — native focus/IME still works.
  }
}
