import { Job, Worker } from 'bullmq';
import {
  TMDB_JOB_RATE_LIMIT_DURATION_MS,
  TMDB_JOB_RATE_LIMIT_MAX,
  WORKER_CONCURRENCY
} from '../config';
import { getBullMqConnection, hasRedisConfig } from './redis';
import {
  enqueueTrackedWatchlistRefreshes,
  ensureWatchlistJobScheduler,
  WATCHLIST_QUEUE_NAME,
  WATCHLIST_REFRESH_JOB,
  WATCHLIST_SCAN_JOB,
  type WatchlistJobData
} from './watchlist-jobs';
import { listTrackedWatchlistTvIds, refreshWatchlistTitle } from './watchlist-sync';

export async function startWatchlistWorker(): Promise<void> {
  if (!hasRedisConfig()) {
    console.log('[watchlist-worker] REDIS_URL not configured, worker disabled');
    return;
  }

  await ensureWatchlistJobScheduler();

  const worker = new Worker<WatchlistJobData, void, string>(
    WATCHLIST_QUEUE_NAME,
    async (job) => {
      await processWatchlistJob(job);
    },
    {
      connection: getBullMqConnection(),
      concurrency: WORKER_CONCURRENCY,
      limiter: {
        max: TMDB_JOB_RATE_LIMIT_MAX,
        duration: TMDB_JOB_RATE_LIMIT_DURATION_MS
      }
    }
  );

  worker.on('completed', (job) => {
    console.log(`[watchlist-worker] completed ${job.name}#${job.id}`);
  });
  worker.on('failed', (job, error) => {
    console.error(`[watchlist-worker] failed ${job?.name ?? 'unknown'}#${job?.id ?? 'n/a'}`, error);
  });
  worker.on('error', (error) => {
    console.error('[watchlist-worker] error', error);
  });

  console.log(
    `[watchlist-worker] started concurrency=${WORKER_CONCURRENCY} rate=${TMDB_JOB_RATE_LIMIT_MAX}/${TMDB_JOB_RATE_LIMIT_DURATION_MS}ms`
  );
}

async function processWatchlistJob(job: Job<WatchlistJobData, void, string>): Promise<void> {
  if (job.name === WATCHLIST_SCAN_JOB) {
    await enqueueTrackedWatchlistRefreshes(listTrackedWatchlistTvIds());
    return;
  }

  if (job.name === WATCHLIST_REFRESH_JOB) {
    const { tmdbId } = job.data as { tmdbId: number };
    await refreshWatchlistTitle(tmdbId);
    return;
  }

  throw new Error(`Unsupported watchlist job: ${job.name}`);
}
