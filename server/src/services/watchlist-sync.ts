import { query } from '../db';
import { getAiredEpisodesCount, getTmdbTvSummary, readCachedTmdbTvSummary } from './tmdb-cache';
import { publishUserWatchlistChanged } from './user-live';

export async function listTrackedWatchlistTvIds(): Promise<number[]> {
  const res = await query<{ tmdb_id: number }>(`
    SELECT DISTINCT tmdb_id
    FROM watchlist
    WHERE media_type = 'tv'
  `);
  return res.rows.map((row) => row.tmdb_id);
}

export async function refreshWatchlistTitle(tmdbId: number): Promise<void> {
  const previousSummary = await readCachedTmdbTvSummary(tmdbId);
  const nextSummary = await getTmdbTvSummary(tmdbId, { forceRefresh: true });
  if (!nextSummary) return;

  const previousAired = getAiredEpisodesCount(previousSummary);
  const nextAired = getAiredEpisodesCount(nextSummary);
  if (previousAired === nextAired) return;

  const watchersRes = await query<{ user_id: number; status: string; done_aired_episodes: number }>(`
    SELECT user_id, status, done_aired_episodes
    FROM watchlist
    WHERE tmdb_id = $1 AND media_type = 'tv'
  `, [tmdbId]);
  const watchers = watchersRes.rows;
  if (watchers.length === 0) return;

  for (const watcher of watchers) {
    if (watcher.status !== 'done') continue;
    if (nextAired <= watcher.done_aired_episodes) continue;

    await query(`
      UPDATE watchlist
      SET status = 'in_progress'
      WHERE user_id = $1 AND tmdb_id = $2 AND media_type = 'tv' AND status = 'done'
    `, [watcher.user_id, tmdbId]);
  }

  publishUserWatchlistChanged(
    [...new Set(watchers.map((watcher) => watcher.user_id))],
    { reason: 'new-episode', tmdb_id: tmdbId, media_type: 'tv' }
  );
}
