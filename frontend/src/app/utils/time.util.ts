/** `h:mm:ss` for ≥1h, otherwise `m:ss`. Floors fractional seconds. */
export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Formats a TMDB movie/TV runtime payload into Italian short form. */
export function formatRuntime(
  item: { runtime?: number; episode_run_time?: number[] },
  type: 'movie' | 'tv' | null
): string {
  if (type === 'movie') {
    const r = item.runtime;
    if (!r) return '';
    const h = Math.floor(r / 60);
    const m = r % 60;
    if (h && m) return `${h}h ${m}min`;
    if (h) return `${h}h`;
    return `${m}min`;
  }
  if (type === 'tv') {
    const first = (item.episode_run_time ?? [])[0];
    return first ? `${first} min/episodio` : '';
  }
  return '';
}

/** Stable key for the `seriesProgress` map. Single source of truth — shared
 *  by `PlayerService.seriesProgress` and the watch-page template lookups. */
export function progressKey(season: number, episode: number): string {
  return `s${season}e${episode}`;
}
