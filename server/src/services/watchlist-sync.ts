import { db } from '../db';
import { getAiredEpisodesCount, getTmdbTvSummary, readCachedTmdbTvSummary } from './tmdb-cache';
import { publishUserWatchlistChanged } from './user-live';

export function listTrackedWatchlistTvIds(): number[] {
  return (db.prepare(`
    SELECT DISTINCT tmdb_id
    FROM watchlist
    WHERE media_type = 'tv'
  `).all() as Array<{ tmdb_id: number }>).map((row) => row.tmdb_id);
}

export async function refreshWatchlistTitle(tmdbId: number): Promise<void> {
  const previousSummary = readCachedTmdbTvSummary(tmdbId);
  const nextSummary = await getTmdbTvSummary(tmdbId, { forceRefresh: true });
  if (!nextSummary) return;

  const previousAired = getAiredEpisodesCount(previousSummary);
  const nextAired = getAiredEpisodesCount(nextSummary);
  if (previousAired === nextAired) return;

  const watchers = db.prepare(`
    SELECT user_id, status, done_aired_episodes
    FROM watchlist
    WHERE tmdb_id = ? AND media_type = 'tv'
  `).all(tmdbId) as Array<{ user_id: number; status: string; done_aired_episodes: number }>;
  if (watchers.length === 0) return;

  for (const watcher of watchers) {
    if (watcher.status !== 'done') continue;
    if (nextAired <= watcher.done_aired_episodes) continue;

    db.prepare(`
      UPDATE watchlist
      SET status = 'todo'
      WHERE user_id = ? AND tmdb_id = ? AND media_type = 'tv' AND status = 'done'
    `).run(watcher.user_id, tmdbId);
  }

  publishUserWatchlistChanged(
    [...new Set(watchers.map((watcher) => watcher.user_id))],
    { reason: 'new-episode', tmdb_id: tmdbId, media_type: 'tv' }
  );
}
