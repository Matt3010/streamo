import { db } from '../db';
import { getTmdbTvSummary } from './tmdb-cache';

// Walks TMDB's seasons array to find the episode immediately after
// (season, episode). Returns null if no later episode has aired.
export async function findNextEpisode(tmdbId: number, season: number, episode: number): Promise<{ season: number; episode: number } | null> {
  const summary = await getTmdbTvSummary(tmdbId);
  if (!summary?.seasons?.length) return null;
  const current = summary.seasons.find(s => s.season_number === season);
  if (current && episode + 1 <= current.episode_count) {
    return { season, episode: episode + 1 };
  }
  const future = summary.seasons
    .filter(s => s.season_number > season && s.episode_count > 0)
    .sort((a, b) => a.season_number - b.season_number)[0];
  return future ? { season: future.season_number, episode: 1 } : null;
}

// "Where to play next" for a TV show given a user's progress: returns the
// latest touched episode, pivoted forward if the player saved that episode
// at exactly position == duration (the 'ended' event handler signature).
// Falls back to the last touched episode if there is no following one.
export async function resolveNextPlayable(userId: number, tmdbId: number): Promise<{ season: number; episode: number } | null> {
  const last = db.prepare(`
    SELECT season, episode, position, duration FROM progress
    WHERE user_id = ? AND tmdb_id = ? AND media_type = 'tv'
    ORDER BY updated_at DESC, season DESC, episode DESC
    LIMIT 1
  `).get(userId, tmdbId) as { season: number; episode: number; position: number; duration: number } | undefined;
  if (!last) return null;

  const ended = last.duration > 0 && last.position >= last.duration;
  if (!ended) return { season: last.season, episode: last.episode };

  const next = await findNextEpisode(tmdbId, last.season, last.episode);
  return next ?? { season: last.season, episode: last.episode };
}
