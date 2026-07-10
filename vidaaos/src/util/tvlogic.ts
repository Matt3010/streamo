// Port of TVLogic.kt. Season/episode traversal + aired-episode gating.
// TmdbItem/TmdbSeasonInfo/TmdbEpisodeRef/TmdbEpisodeDetail are minimal structural
// mirrors of the Kotlin DTOs in data/remote/dto/TmdbModels.kt — only the fields
// TVLogic actually reads are required.

export const WATCHED_THRESHOLD = 0.9;

export interface TmdbEpisodeRef {
  seasonNumber: number | null;
  episodeNumber: number | null;
  airDate: string | null;
}

export interface TmdbSeasonInfo {
  seasonNumber: number;
  episodeCount: number | null;
  name?: string | null;
  airDate?: string | null;
}

export interface TmdbEpisodeDetail {
  episodeNumber: number;
  seasonNumber?: number | null;
  name?: string | null;
  overview?: string | null;
  stillPath?: string | null;
  airDate?: string | null;
  runtime?: number | null;
}

export interface TmdbItem {
  id: number;
  mediaType?: string | null;
  title?: string | null;
  name?: string | null;
  numberOfSeasons?: number | null;
  numberOfEpisodes?: number | null;
  seasons?: TmdbSeasonInfo[] | null;
  lastEpisodeToAir?: TmdbEpisodeRef | null;
  nextEpisodeToAir?: TmdbEpisodeRef | null;
}

function ymd(s: string | null | undefined): [number, number, number] | null {
  if (!s || s.length < 10) return null;
  const parts = s.substring(0, 10).split('-');
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return null;
  return [y, m, d];
}

export function isFutureDate(dateStr: string | null | undefined): boolean {
  const parts = ymd(dateStr);
  if (!parts) return false;
  const [y, m, d] = parts;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(y, m - 1, d, 0, 0, 0, 0);
  return date.getTime() > today.getTime();
}

export function countEpisodesUpTo(item: TmdbItem, season: number | null, episode: number | null): number {
  if (season == null || episode == null) return item.numberOfEpisodes ?? 0;
  let count = 0;
  for (const s of (item.seasons ?? []).filter((s) => s.seasonNumber !== 0)) {
    if (s.seasonNumber < season) count += s.episodeCount ?? 0;
    else if (s.seasonNumber === season) count += episode;
  }
  return count;
}

export function effectiveLastEpisode(item: TmdbItem): [number, number] | null {
  const nea = item.nextEpisodeToAir;
  if (nea?.seasonNumber != null && nea.episodeNumber != null && nea.airDate != null && !isFutureDate(nea.airDate)) {
    return [nea.seasonNumber, nea.episodeNumber];
  }
  const lea = item.lastEpisodeToAir;
  if (lea?.seasonNumber != null && lea.episodeNumber != null) {
    return [lea.seasonNumber, lea.episodeNumber];
  }
  return null;
}

export function airedEpisodesCount(item: TmdbItem): number {
  const lea = effectiveLastEpisode(item);
  if (!lea) return 0;
  return countEpisodesUpTo(item, lea[0], lea[1]);
}

export function airedEpisodesInSeason(item: TmdbItem, season: number): number {
  const info = (item.seasons ?? []).find((s) => s.seasonNumber === season);
  if (!info) return 0;
  const total = info.episodeCount ?? 0;
  const lea = effectiveLastEpisode(item);
  if (!lea) return total;
  const [lastSeason, lastEp] = lea;
  if (season < lastSeason) return total;
  if (season > lastSeason) return 0;
  return Math.min(total, lastEp);
}

export function episodesBefore(item: TmdbItem, season: number, episode: number): number {
  if (season <= 0) return 0;
  return countEpisodesUpTo(item, season, Math.max(0, episode - 1));
}

export function availableSeasons(item: TmdbItem): number[] {
  const seasons = (item.seasons ?? []).filter((s) => s.seasonNumber > 0);
  let nums: number[];
  const last = effectiveLastEpisode(item);
  if (last) {
    const lastAired = last[0];
    nums = seasons.filter((s) => s.seasonNumber <= lastAired).map((s) => s.seasonNumber);
  } else {
    nums = seasons.filter((s) => s.airDate != null && !isFutureDate(s.airDate)).map((s) => s.seasonNumber);
  }
  nums.sort((a, b) => a - b);
  return nums.length ? nums : [1];
}

export function nextEpisode(item: TmdbItem, season: number, episode: number): [number, number] | null {
  const currentAired = airedEpisodesInSeason(item, season);
  if (currentAired > 0 && episode + 1 <= currentAired) {
    return [season, episode + 1];
  }
  const future = (item.seasons ?? [])
    .filter((s) => s.seasonNumber > season && airedEpisodesInSeason(item, s.seasonNumber) > 0)
    .sort((a, b) => a.seasonNumber - b.seasonNumber)[0];
  return future ? [future.seasonNumber, 1] : null;
}

export function previousEpisode(item: TmdbItem, season: number, episode: number): [number, number] | null {
  if (episode > 1) return [season, episode - 1];
  const past = (item.seasons ?? [])
    .filter((s) => s.seasonNumber < season && airedEpisodesInSeason(item, s.seasonNumber) > 0)
    .sort((a, b) => b.seasonNumber - a.seasonNumber)[0];
  return past ? [past.seasonNumber, airedEpisodesInSeason(item, past.seasonNumber)] : null;
}

export function airedEpisodeList(
  episodes: TmdbEpisodeDetail[],
  item: TmdbItem,
  season: number,
): TmdbEpisodeDetail[] {
  const sorted = [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber);
  const lea = effectiveLastEpisode(item);
  if (lea) {
    const [lastSeason, lastEp] = lea;
    if (season < lastSeason) return sorted;
    if (season > lastSeason) return [];
    return sorted.filter((e) => e.episodeNumber <= lastEp);
  }
  return sorted.filter((e) => e.airDate != null && !isFutureDate(e.airDate));
}

// ponytail: one runnable self-check. Mirrors the nextEpisode/previousEpisode
// contract: at the last aired episode of S1, next crosses to the next aired
// season; previous of S2E1 lands on the prior season's last aired episode.
export function demo(): void {
  const item: TmdbItem = {
    id: 1,
    numberOfEpisodes: 20,
    seasons: [
      { seasonNumber: 1, episodeCount: 10, airDate: '2020-01-01' },
      { seasonNumber: 2, episodeCount: 10, airDate: '2021-01-01' },
    ],
    lastEpisodeToAir: { seasonNumber: 2, episodeNumber: 5, airDate: '2021-02-01' },
    nextEpisodeToAir: { seasonNumber: 2, episodeNumber: 6, airDate: '2099-01-01' },
  };
  // S2E5 is the last aired → next is S2E6 only if 6 <= airedInSeason(2)=5 → false →
  // no later aired season → null.
  console.assert(nextEpisode(item, 2, 5) === null, 'nextEpisode at last aired should be null');
  // previousEpisode(S2E1) → S1 last aired = 10.
  const prev = previousEpisode(item, 2, 1);
  console.assert(prev !== null && prev[0] === 1 && prev[1] === 10, 'previousEpisode S2E1 -> S1E10');
  // isFutureDate on a clearly future date is true, on a past date false.
  console.assert(isFutureDate('2099-12-31') === true, 'future date');
  console.assert(isFutureDate('2000-01-01') === false, 'past date');
  console.assert(isFutureDate(null) === false, 'null date');
  console.assert(isFutureDate('garbage') === false, 'garbage date');
  console.log('tvlogic.ts demo: OK');
}

// ponytail: run the self-check only under Node (tsx). `typeof process` is safe
// in the browser (where `process` is undefined) so this never throws there.
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('tvlogic.ts')) demo();