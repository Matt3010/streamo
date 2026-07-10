// CSS class helpers for the focus visual language (mirror TvFocusModifiers).
export type FocusStyle = 'frame' | 'ring' | 'fill';

export function focusClasses(
  focused: boolean,
  opts: { scale?: number; frame?: boolean; ring?: boolean; fill?: boolean; extra?: string }
): string {
  const base = 'focusable';
  if (!focused) return opts.extra ? `${base} ${opts.extra}` : base;
  const mods: string[] = ['f-focus'];
  if (opts.scale && opts.scale !== 1) mods.push('scale');
  if (opts.frame) mods.push('frame');
  if (opts.ring) mods.push('ring');
  if (opts.fill) mods.push('fill');
  return [base, ...mods, opts.extra].filter(Boolean).join(' ');
}

// Inline style for the focus scale value (CSS var --scale).
export function focusScaleVar(scale?: number): Record<string, string> | undefined {
  if (!scale || scale === 1) return undefined;
  return { '--scale': String(scale) } as Record<string, string>;
}