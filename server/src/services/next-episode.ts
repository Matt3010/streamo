import { kdb } from '../db';
import { WATCHED_THRESHOLD } from '../config';
import { getTmdbTvSummary, isFutureDate } from './tmdb-cache';

function getEffectiveLastEpisode(summary: Awaited<ReturnType<typeof getTmdbTvSummary>>): { season_number: number; episode_number: number } | null {
  if (!summary) return null;
  const nea = summary.next_episode_to_air;
  const neaHasAired = nea?.air_date ? !isFutureDate(nea.air_date) : false;
  if (neaHasAired && nea) {
    return { season_number: nea.season_number, episode_number: nea.episode_number };
  }
  return summary.last_episode_to_air ?? null;
}

function airedEpisodesInSeason(
  summary: Awaited<ReturnType<typeof getTmdbTvSummary>>,
  season: number
): number {
  if (!summary) return 0;
  const lea = getEffectiveLastEpisode(summary);
  const seasonInfo = summary.seasons.find(s => s.season_number === season);
  if (!seasonInfo) return 0;
  if (!lea) return seasonInfo.episode_count;
  if (season < lea.season_number) return seasonInfo.episode_count;
  if (season > lea.season_number) return 0;
  return Math.min(seasonInfo.episode_count, lea.episode_number);
}

// Walks TMDB's seasons array to find the episode immediately after
// (season, episode). Returns null if no later episode has aired.
export async function findNextEpisode(tmdbId: number, season: number, episode: number): Promise<{ season: number; episode: number } | null> {
  const summary = await getTmdbTvSummary(tmdbId);
  if (!summary?.seasons?.length) return null;
  const currentAiredCount = airedEpisodesInSeason(summary, season);
  if (currentAiredCount > 0 && episode + 1 <= currentAiredCount) {
    return { season, episode: episode + 1 };
  }
  const future = summary.seasons
    .filter(s => s.season_number > season && airedEpisodesInSeason(summary, s.season_number) > 0)
    .sort((a, b) => a.season_number - b.season_number)[0];
  return future ? { season: future.season_number, episode: 1 } : null;
}

// "Where to play next" for a TV show given a user's progress: returns the
// latest touched episode, pivoted forward when the user is effectively done
// with that episode. The threshold (WATCHED_THRESHOLD = 0.8) matches the
// "watched" cutoff used everywhere else and absorbs the float drift between
// what the player reports as position and what the source says is duration
// (e.g. position 3086 vs duration 3086.249822 would have failed a strict
// `>=` check and pinned the user to the already-finished episode).
export async function resolveNextPlayable(userId: number, tmdbId: number): Promise<{ season: number; episode: number } | null> {
  const last = await kdb
    .selectFrom('progress')
    .select(['season', 'episode', 'position', 'duration'])
    .where('user_id', '=', userId)
    .where('tmdb_id', '=', tmdbId)
    .where('media_type', '=', 'tv')
    .where('synthetic', '=', 0)
    .orderBy('updated_at', 'desc')
    .orderBy('season', 'desc')
    .orderBy('episode', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!last) return null;

  const ended = last.duration > 0 && last.position >= last.duration * WATCHED_THRESHOLD;
  if (!ended) return { season: last.season, episode: last.episode };

  const next = await findNextEpisode(tmdbId, last.season, last.episode);
  return next ?? { season: last.season, episode: last.episode };
}
