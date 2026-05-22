import { Job, Worker } from 'bullmq';
import {
  TMDB_JOB_RATE_LIMIT_DURATION_MS,
  TMDB_JOB_RATE_LIMIT_MAX,
  WORKER_CONCURRENCY
} from '../config';
import { assertRedisReady, getBullMqConnection, hasRedisConfig } from './redis';
import {
  ADMIN_HEALTH_SCAN_JOB,
  cleanupLegacyWatchlistJobs,
  enqueueTrackedWatchlistRefreshes,
  ensureWatchlistJobScheduler,
  RESUME_REMINDER_SCAN_JOB,
  WATCHLIST_QUEUE_NAME,
  WATCHLIST_REFRESH_JOB,
  WATCHLIST_SCAN_JOB,
  type WatchlistJobData
} from './watchlist-jobs';
import { startWorkerHeartbeat } from './worker-heartbeat';
import { listTrackedWatchlistTvIds, refreshWatchlistTitle } from './watchlist-sync';
import { runResumeReminderScan } from './resume-reminder';
import { runAdminHealthChecks } from './admin-health';

export async function startWatchlistWorker(): Promise<void> {
  if (!hasRedisConfig()) {
    throw new Error('REDIS_URL is required for the watchlist worker');
  }

  await assertRedisReady();
  await ensureWatchlistJobScheduler();
  const removedLegacyJobs = await cleanupLegacyWatchlistJobs();
  if (removedLegacyJobs > 0) {
    console.log(`[watchlist-worker] removed ${removedLegacyJobs} legacy failed jobs`);
  }

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
  const stopHeartbeat = startWorkerHeartbeat();

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

  const shutdown = async (): Promise<void> => {
    stopHeartbeat?.();
    await worker.close();
  };
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
}

async function processWatchlistJob(job: Job<WatchlistJobData, void, string>): Promise<void> {
  if (job.name === WATCHLIST_SCAN_JOB) {
    await enqueueTrackedWatchlistRefreshes(await listTrackedWatchlistTvIds());
    return;
  }

  if (job.name === WATCHLIST_REFRESH_JOB) {
    const data = job.data as unknown;
    if (typeof data !== 'object' || data === null || typeof (data as { tmdbId?: unknown }).tmdbId !== 'number') {
      throw new Error(`invalid watchlist refresh payload: ${JSON.stringify(data)}`);
    }
    await refreshWatchlistTitle((data as { tmdbId: number }).tmdbId);
    return;
  }

  if (job.name === RESUME_REMINDER_SCAN_JOB) {
    const summary = await runResumeReminderScan();
    console.log(`[watchlist-worker] resume-reminder scanned=${summary.scanned} sent=${summary.sent}`);
    return;
  }

  if (job.name === ADMIN_HEALTH_SCAN_JOB) {
    await runAdminHealthChecks();
    return;
  }

  throw new Error(`Unsupported watchlist job: ${job.name}`);
}
