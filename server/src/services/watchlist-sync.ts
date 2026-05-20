import { kdb } from '../db';
import { getAiredEpisodesCount, getTmdbTvSummary, readCachedTmdbTvSummary } from './tmdb-cache';
import { publishUserWatchlistChanged } from './user-live';
import { providerResolveLogger } from './provider-resolve-logs';

export async function listTrackedWatchlistTvIds(): Promise<number[]> {
  const rows = await kdb
    .selectFrom('watchlist')
    .select('tmdb_id')
    .where('media_type', '=', 'tv')
    .distinct()
    .orderBy('tmdb_id', 'asc')
    .execute();
  return rows.map((row) => row.tmdb_id);
}

export async function refreshWatchlistTitle(tmdbId: number): Promise<void> {
  const previousSummary = await readCachedTmdbTvSummary(tmdbId);
  const nextSummary = await getTmdbTvSummary(tmdbId, { forceRefresh: true });
  if (!nextSummary) {
    providerResolveLogger.warn('watchlist-refresh-skip-no-summary', { tmdbId });
    return;
  }

  const previousAired = getAiredEpisodesCount(previousSummary);
  const nextAired = getAiredEpisodesCount(nextSummary);
  if (previousAired === nextAired) return;

  const watchers = await kdb
    .selectFrom('watchlist')
    .select(['user_id', 'status', 'done_aired_episodes'])
    .where('tmdb_id', '=', tmdbId)
    .where('media_type', '=', 'tv')
    .execute();
  if (watchers.length === 0) return;

  for (const watcher of watchers) {
    if (watcher.status !== 'done') continue;
    if (nextAired <= watcher.done_aired_episodes) continue;

    await kdb
      .updateTable('watchlist')
      .set({ status: 'in_progress' })
      .where('user_id', '=', watcher.user_id)
      .where('tmdb_id', '=', tmdbId)
      .where('media_type', '=', 'tv')
      .where('status', '=', 'done')
      .execute();
  }

  publishUserWatchlistChanged(
    [...new Set(watchers.map((watcher) => watcher.user_id))],
    { reason: 'new-episode', tmdb_id: tmdbId, media_type: 'tv' }
  );
}
