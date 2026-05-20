import { Queue } from 'bullmq';
import { TMDB_API_KEY, TMDB_REFRESH_INTERVAL_SECONDS } from '../config';
import { getBullMqConnection, hasRedisConfig } from './redis';

export const WATCHLIST_QUEUE_NAME = 'watchlist-sync';
export const WATCHLIST_SCAN_JOB = 'scan-watchlists';
export const WATCHLIST_REFRESH_JOB = 'refresh-watchlist-title';

interface ScanWatchlistsJobData {
  source?: 'scheduler';
}

interface RefreshWatchlistTitleJobData {
  tmdbId: number;
  source?: 'scheduler' | 'watchlist-add' | 'manual';
}

export type WatchlistJobData = ScanWatchlistsJobData | RefreshWatchlistTitleJobData;

let queue: Queue<WatchlistJobData, void, string> | null = null;

export function getWatchlistQueue(): Queue<WatchlistJobData, void, string> | null {
  if (!hasRedisConfig()) return null;
  if (!queue) {
    queue = new Queue<WatchlistJobData, void, string>(WATCHLIST_QUEUE_NAME, {
      connection: getBullMqConnection(),
      defaultJobOptions: {
        // Retain by age so successful jobs disappear after 1h and failed
        // ones stay around for 24h for debugging, but bounded by count to
        // avoid unbounded growth if the queue is busy.
        removeOnComplete: { age: 3600, count: 200 },
        removeOnFail: { age: 86400, count: 500 }
      }
    });
  }
  return queue;
}

export async function ensureWatchlistJobScheduler(): Promise<void> {
  const watchlistQueue = getWatchlistQueue();
  if (!watchlistQueue || !TMDB_API_KEY || TMDB_REFRESH_INTERVAL_SECONDS <= 0) return;

  await watchlistQueue.upsertJobScheduler(
    'watchlist-scan',
    { every: TMDB_REFRESH_INTERVAL_SECONDS * 1000 },
    {
      name: WATCHLIST_SCAN_JOB,
      data: { source: 'scheduler' },
      opts: {
        removeOnComplete: 10,
        removeOnFail: 20
      }
    }
  );
}

export async function cleanupLegacyWatchlistJobs(): Promise<number> {
  const watchlistQueue = getWatchlistQueue();
  if (!watchlistQueue) return 0;

  const failedJobs = await watchlistQueue.getFailed(0, 200);
  let removed = 0;
  for (const job of failedJobs) {
    const failedReason = typeof job.failedReason === 'string' ? job.failedReason : '';
    const hasLegacyCustomIdError = failedReason.includes('Custom Id cannot contain :');
    const hasLegacyJobId = typeof job.id === 'string' && job.id.includes('watchlist-title:');
    if (!hasLegacyCustomIdError && !hasLegacyJobId) continue;

    await job.remove();
    removed += 1;
  }

  return removed;
}

export async function enqueueWatchlistTitleRefresh(
  tmdbId: number,
  source: RefreshWatchlistTitleJobData['source'] = 'manual'
): Promise<void> {
  const watchlistQueue = getWatchlistQueue();
  if (!watchlistQueue) return;

  await watchlistQueue.add(
    WATCHLIST_REFRESH_JOB,
    { tmdbId, source },
    {
      jobId: `watchlist-title-${tmdbId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 }
    }
  );
}

export async function enqueueTrackedWatchlistRefreshes(tmdbIds: number[]): Promise<void> {
  const watchlistQueue = getWatchlistQueue();
  if (!watchlistQueue || tmdbIds.length === 0) return;

  const uniqueIds = [...new Set(tmdbIds)];
  await watchlistQueue.addBulk(uniqueIds.map((tmdbId) => ({
    name: WATCHLIST_REFRESH_JOB,
    data: { tmdbId, source: 'scheduler' } satisfies RefreshWatchlistTitleJobData,
    opts: {
      jobId: `watchlist-title-${tmdbId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 }
    }
  })));
}
