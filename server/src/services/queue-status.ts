import type { Queue } from 'bullmq';
import { TMDB_API_KEY, TMDB_REFRESH_INTERVAL_SECONDS } from '../config';
import { createRedisClient, hasRedisConfig } from './redis';
import { getWatchlistQueue, WATCHLIST_QUEUE_NAME } from './watchlist-jobs';
import { getNotificationsDeliveryQueue, NOTIFICATIONS_DELIVERY_QUEUE_NAME } from './notifications-jobs';
import { listWorkerHeartbeats } from './worker-heartbeat';
import type { AdminQueueCounts, AdminQueueSnapshot, AdminQueueStatus } from '../../../shared/types';

const EMPTY_COUNTS: AdminQueueCounts = {
  waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0, paused: 0
};

interface QueueRegistration {
  name: string;
  queue: Queue<unknown, unknown, string> | null;
}

export async function getAdminQueueStatus(): Promise<AdminQueueStatus> {
  const registrations: QueueRegistration[] = [
    { name: WATCHLIST_QUEUE_NAME, queue: getWatchlistQueue() as Queue<unknown, unknown, string> | null },
    { name: NOTIFICATIONS_DELIVERY_QUEUE_NAME, queue: getNotificationsDeliveryQueue() as Queue<unknown, unknown, string> | null }
  ];

  const base: AdminQueueStatus = {
    redis_configured: hasRedisConfig(),
    scheduler_enabled: !!TMDB_API_KEY && TMDB_REFRESH_INTERVAL_SECONDS > 0,
    queues: registrations.map((r) => ({
      name: r.name,
      available: !!r.queue,
      counts: { ...EMPTY_COUNTS }
    })),
    workers: []
  };

  if (!hasRedisConfig()) return base;

  const [queues, workers] = await Promise.all([
    Promise.all(registrations.map((r) => snapshot(r))),
    withRedisClient(async (redis) => listWorkerHeartbeats(redis))
  ]);

  return { ...base, queues, workers };
}

async function snapshot(reg: QueueRegistration): Promise<AdminQueueSnapshot> {
  if (!reg.queue) {
    return { name: reg.name, available: false, counts: { ...EMPTY_COUNTS } };
  }
  const c = await reg.queue.getJobCounts(
    'waiting', 'active', 'delayed', 'completed', 'failed', 'paused'
  );
  return {
    name: reg.name,
    available: true,
    counts: {
      waiting: c.waiting ?? 0,
      active: c.active ?? 0,
      delayed: c.delayed ?? 0,
      completed: c.completed ?? 0,
      failed: c.failed ?? 0,
      paused: c.paused ?? 0
    }
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
