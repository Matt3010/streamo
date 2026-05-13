import { db } from '../db';
import { TMDB_API_KEY, TMDB_REFRESH_INTERVAL_SECONDS } from '../config';
import { getAiredEpisodesCount, getTmdbTvSummary, readCachedTmdbTvSummary } from './tmdb-cache';
import { notifyUserWatchlistChanged } from './user-live';

let refreshTimer: NodeJS.Timeout | null = null;
let refreshInFlight = false;

export function startWatchlistRefreshLoop(): void {
  if (refreshTimer || !TMDB_API_KEY || TMDB_REFRESH_INTERVAL_SECONDS <= 0) {
    return;
  }

  refreshTimer = setInterval(() => {
    void runWatchlistRefreshCycle();
  }, TMDB_REFRESH_INTERVAL_SECONDS * 1000);

  setTimeout(() => {
    void runWatchlistRefreshCycle();
  }, 15000);
}

async function runWatchlistRefreshCycle(): Promise<void> {
  if (refreshInFlight) return;
  refreshInFlight = true;

  try {
    const rows = db.prepare(`
      SELECT DISTINCT tmdb_id
      FROM watchlist
      WHERE media_type = 'tv'
    `).all() as Array<{ tmdb_id: number }>;

    for (const row of rows) {
      await refreshWatchlistTitle(row.tmdb_id);
    }
  } finally {
    refreshInFlight = false;
  }
}

async function refreshWatchlistTitle(tmdbId: number): Promise<void> {
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

  const userIds = [...new Set(watchers.map((watcher) => watcher.user_id))];
  if (userIds.length === 0) return;

  notifyUserWatchlistChanged(userIds, {
    reason: 'new-episode',
    tmdb_id: tmdbId,
    media_type: 'tv'
  });
}
