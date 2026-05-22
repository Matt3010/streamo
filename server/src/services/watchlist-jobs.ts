import { Queue } from 'bullmq';
import { RESUME_REMINDER_INTERVAL_SECONDS, TMDB_API_KEY, TMDB_REFRESH_INTERVAL_SECONDS } from '../config';
import { getBullMqConnection, hasRedisConfig } from './redis';

export const WATCHLIST_QUEUE_NAME = 'watchlist-sync';
export const WATCHLIST_SCAN_JOB = 'scan-watchlists';
export const WATCHLIST_REFRESH_JOB = 'refresh-watchlist-title';
export const RESUME_REMINDER_SCAN_JOB = 'resume-reminder-scan';
export const ADMIN_HEALTH_SCAN_JOB = 'admin-health-scan';

interface ScanWatchlistsJobData {
  source?: 'scheduler';
}

interface RefreshWatchlistTitleJobData {
  tmdbId: number;
  source?: 'scheduler' | 'watchlist-add' | 'manual';
}

interface ResumeReminderScanJobData {
  source?: 'scheduler';
}

interface AdminHealthScanJobData {
  source?: 'scheduler';
}

export type WatchlistJobData =
  | ScanWatchlistsJobData
  | RefreshWatchlistTitleJobData
  | ResumeReminderScanJobData
  | AdminHealthScanJobData;

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
  if (!watchlistQueue) return;

  if (TMDB_API_KEY && TMDB_REFRESH_INTERVAL_SECONDS > 0) {
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

  await watchlistQueue.upsertJobScheduler(
    'resume-reminder-scan',
    { every: RESUME_REMINDER_INTERVAL_SECONDS * 1000 },
    {
      name: RESUME_REMINDER_SCAN_JOB,
      data: { source: 'scheduler' },
      opts: {
        removeOnComplete: 10,
        removeOnFail: 20
      }
    }
  );

  // Admin health probe — every 5 minutes. Piggybacks on the watchlist-sync
  // queue rather than adding a new one so bull-board / queue-status / the
  // worker process stay singular. Frequency picked to keep alert latency
  // bounded while leaving plenty of headroom over the heartbeat staleness
  // threshold (90s) we use to flag a dead worker.
  await watchlistQueue.upsertJobScheduler(
    'admin-health-scan',
    { every: 5 * 60 * 1000 },
    {
      name: ADMIN_HEALTH_SCAN_JOB,
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
