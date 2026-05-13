import { TMDB_API_KEY, TMDB_REFRESH_INTERVAL_SECONDS } from '../config';
import { createRedisClient, hasRedisConfig } from './redis';
import { getWatchlistQueue } from './watchlist-jobs';
import { listWorkerHeartbeats } from './worker-heartbeat';
import type { AdminQueueStatus } from '../../../shared/types';

export async function getAdminQueueStatus(): Promise<AdminQueueStatus> {
  const queue = getWatchlistQueue();
  const base: AdminQueueStatus = {
    redis_configured: hasRedisConfig(),
    queue_available: !!queue,
    scheduler_enabled: !!TMDB_API_KEY && TMDB_REFRESH_INTERVAL_SECONDS > 0,
    counts: {
      waiting: 0,
      active: 0,
      delayed: 0,
      completed: 0,
      failed: 0,
      paused: 0
    },
    workers: []
  };

  if (!queue || !hasRedisConfig()) return base;

  const [counts, workers] = await Promise.all([
    queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed', 'paused'),
    withRedisClient(async (redis) => listWorkerHeartbeats(redis))
  ]);

  return {
    ...base,
    counts: {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      paused: counts.paused ?? 0
    },
    workers
  };
}

async function withRedisClient<T>(fn: (redis: ReturnType<typeof createRedisClient>) => Promise<T>): Promise<T> {
  const redis = createRedisClient();
  try {
    return await fn(redis);
  } finally {
    redis.disconnect();
  }
}
