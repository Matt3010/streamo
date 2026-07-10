// Applies the user's accent color to CSS custom properties. Mirrors Android's
// AppTheme (ui/theme/Theme.kt): onAccent is chosen from the accent's relative
// luminance (white on dark accents, black on light ones), same formula as
// Jetpack Compose's Color.luminance() (WCAG relative luminance).
export interface Accent {
  r: number; // 0..1
  g: number;
  b: number;
}

function toHex(v: number): string {
  return Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16)
    .padStart(2, '0');
}

function srgbChannel(v: number): number {
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function applyAccent(accent: Accent): void {
  const primary = `#${toHex(accent.r)}${toHex(accent.g)}${toHex(accent.b)}`;
  const luminance =
    0.2126 * srgbChannel(accent.r) + 0.7152 * srgbChannel(accent.g) + 0.0722 * srgbChannel(accent.b);
  const onPrimary = luminance > 0.5 ? '#000000' : '#ffffff';

  const root = document.documentElement.style;
  root.setProperty('--primary', primary);
  root.setProperty('--primary-on', onPrimary);
}
