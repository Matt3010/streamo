import { kdb } from '../db';
import { getAiredEpisodesCount, getTmdbTvSummary, readCachedTmdbTvSummary, type TmdbTvSummary } from './tmdb-cache';
import { publishUserWatchlistChanged } from './user-live';
import { providerResolveLogger } from './provider-resolve-logs';
import { createNotificationsForUsers } from './notifications';
import type { NotificationType } from '../../../shared/types';

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
    .selectFrom('watchlist as w')
    .innerJoin('users as u', 'u.id', 'w.user_id')
    .select([
      'w.user_id', 'w.status', 'w.done_aired_episodes', 'w.title', 'w.poster',
      'u.notif_new_episode', 'u.notif_new_season'
    ])
    .where('w.tmdb_id', '=', tmdbId)
    .where('w.media_type', '=', 'tv')
    .execute();
  if (watchers.length === 0) return;

  // Auto-flip done → in_progress for watchers who completed the show before
  // these new episodes aired.
  const flippedUserIds = new Set<number>();
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
    flippedUserIds.add(watcher.user_id);
  }

  publishUserWatchlistChanged(
    [...new Set(watchers.map((watcher) => watcher.user_id))],
    { reason: 'new-episode', tmdb_id: tmdbId, media_type: 'tv' }
  );

  await sendReleaseNotifications(tmdbId, previousSummary, nextSummary, previousAired, nextAired, watchers, flippedUserIds);
}

interface WatcherRow {
  user_id: number;
  status: 'todo' | 'in_progress' | 'done';
  done_aired_episodes: number;
  title: string | null;
  poster: string | null;
  notif_new_episode: 0 | 1;
  notif_new_season: 0 | 1;
}

async function sendReleaseNotifications(
  tmdbId: number,
  previousSummary: TmdbTvSummary | null,
  nextSummary: TmdbTvSummary,
  previousAired: number,
  nextAired: number,
  watchers: WatcherRow[],
  flippedUserIds: Set<number>
): Promise<void> {
  // No baseline → first time we see this show in cache. Don't fire a
  // "new episode" alert against a phantom zero.
  if (!previousSummary) return;
  if (nextAired <= previousAired) return;

  const prevSeasonAired = previousSummary.last_episode_to_air?.season_number ?? 0;
  const nextSeasonAired = nextSummary.last_episode_to_air?.season_number ?? 0;
  const isNewSeason = nextSeasonAired > prevSeasonAired;
  const type: NotificationType = isNewSeason ? 'new_season' : 'new_episode';

  // Skip users who haven't engaged with the show yet (status='todo') — they
  // don't need an "S3E1 just aired" ping for something they haven't started.
  // Watchers we just auto-flipped from done are included on purpose: the
  // notification is exactly the "new content for a show you'd finished" cue.
  const engaged = watchers.filter((w) => w.status === 'in_progress' || flippedUserIds.has(w.user_id));
  const eligible = engaged.filter((w) => isNewSeason ? w.notif_new_season === 1 : w.notif_new_episode === 1);
  if (eligible.length === 0) return;

  // title/poster are per-watcher but derive from TMDB at add-time, so they
  // should be effectively identical for the same tmdb_id. Pick the first
  // non-null pair so the notification still renders if some rows lack it.
  const labelSource = eligible.find((w) => w.title) ?? eligible[0];

  await createNotificationsForUsers({
    userIds: eligible.map((w) => w.user_id),
    type,
    tmdbId,
    mediaType: 'tv',
    title: labelSource.title,
    poster: labelSource.poster,
    payload: {
      season: nextSummary.last_episode_to_air?.season_number,
      episode: nextSummary.last_episode_to_air?.episode_number,
      aired_delta: nextAired - previousAired
    }
  });
}
