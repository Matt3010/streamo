// Port of Format.kt. Time/percent/minutes/watch-time formatting.
// Output strings match the Kotlin source (Italian where the source is Italian).

export function time(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function percent(position: number, duration: number): number {
  if (duration <= 0) return 0.0;
  return Math.min(100.0, Math.max(0.0, (position / duration) * 100));
}

export function viewedMinutes(position: number | null | undefined): string | null {
  if (position == null) return null;
  if (position <= 0) return null;
  const minutes = Math.max(1, Math.floor(position / 60));
  return minutes === 1 ? 'Visto 1 min' : `Visti ${minutes} min`;
}

export function watchTime(seconds: number): string {
  const totalMin = Math.floor(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return `${m} min`;
}

// "Xh Ymin rimasti" — remaining-time label used by the player/UI. Not in Format.kt
// directly but derived from watchTime-style formatting across the app; kept here as
// the single Italian remaining-time formatter.
export function remainingTime(secondsRemaining: number): string {
  if (!Number.isFinite(secondsRemaining) || secondsRemaining <= 0) return '0 min rimasti';
  const totalMin = Math.floor(secondsRemaining / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}min rimasti` : `${h}h rimasti`;
  return `${m}min rimasti`;
}