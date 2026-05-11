import type { MediaType, TmdbItem } from '../models';

export function getFullReleaseStatusText(item: TmdbItem, type: MediaType): string {
  if (type === 'movie') {
    const date = parseDateOnly(item.release_date);
    if (date && isFutureDate(date)) {
      return `Uscita prevista il ${formatDateLong(date)}.`;
    }
    return '';
  }

  const nextEpisode = item.next_episode_to_air;
  const nextEpisodeDate = parseDateOnly(nextEpisode?.air_date);
  if (nextEpisode && nextEpisodeDate) {
    const season = nextEpisode.season_number ?? '?';
    const episode = nextEpisode.episode_number ?? '?';
    return `Prossimo episodio: S${season} E${episode} in uscita il ${formatDateLong(nextEpisodeDate)}.`;
  }

  const nextSeason = findNextSeason(item);
  if (nextSeason) {
    return `Prossima stagione: Stagione ${nextSeason.season} in uscita il ${formatDateLong(nextSeason.date)}.`;
  }

  if (item.status === 'Ended' || item.status === 'Canceled') {
    return 'Serie conclusa.';
  }

  return '';
}

export function getCompactReleaseStatusText(item: TmdbItem, type: MediaType): string {
  if (type === 'movie') {
    const date = parseDateOnly(item.release_date);
    if (date && isFutureDate(date)) {
      return `Esce il ${formatDateLong(date)}`;
    }
    return '';
  }

  const nextEpisode = item.next_episode_to_air;
  const nextEpisodeDate = parseDateOnly(nextEpisode?.air_date);
  if (nextEpisode && nextEpisodeDate) {
    return `Nuovo episodio ${formatDateShort(nextEpisodeDate)}`;
  }

  const nextSeason = findNextSeason(item);
  if (nextSeason) {
    return `Stagione ${nextSeason.season} il ${formatDateShort(nextSeason.date)}`;
  }

  return '';
}

function findNextSeason(item: TmdbItem): { season: number; date: Date } | null {
  const lastSeason = item.last_episode_to_air?.season_number ?? 0;
  return (item.seasons ?? [])
    .filter((season) => season.season_number > 0)
    .map((season) => ({
      season: season.season_number,
      date: parseDateOnly(season.air_date)
    }))
    .filter((entry): entry is { season: number; date: Date } => entry.date !== null && entry.season > lastSeason)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .find((entry) => isFutureDate(entry.date)) ?? null;
}

function parseDateOnly(raw?: string | null): Date | null {
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? null : date;
}

function isFutureDate(date: Date): boolean {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return date.getTime() > today.getTime();
}

function formatDateLong(date: Date): string {
  return new Intl.DateTimeFormat('it-IT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(date);
}

function formatDateShort(date: Date): string {
  return new Intl.DateTimeFormat('it-IT', {
    day: 'numeric',
    month: 'short'
  }).format(date);
}
