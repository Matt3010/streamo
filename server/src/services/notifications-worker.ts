import { Job, Worker } from 'bullmq';
import { assertRedisReady, getBullMqConnection, hasRedisConfig } from './redis';
import { sendPushToUser } from './fcm';
import {
  DELIVER_PUSH_JOB,
  NOTIFICATIONS_DELIVERY_QUEUE_NAME,
  type DeliverPushJobData
} from './notifications-jobs';

// FCM is HTTP-bound and each call is independent — plenty of headroom
// for parallelism beyond what the TMDB-bound watchlist worker can do.
const NOTIFICATIONS_WORKER_CONCURRENCY = Math.max(
  1,
  Number(process.env.NOTIFICATIONS_WORKER_CONCURRENCY) || 8
);

export async function startNotificationsWorker(): Promise<void> {
  if (!hasRedisConfig()) {
    // No Redis means delivery falls back to inline sends inside
    // enqueuePushDelivery — nothing to schedule here.
    console.log('[notifications-worker] REDIS_URL not set — worker not started (inline delivery)');
    return;
  }

  await assertRedisReady();

  const worker = new Worker<DeliverPushJobData, void, string>(
    NOTIFICATIONS_DELIVERY_QUEUE_NAME,
    async (job) => { await processDeliveryJob(job); },
    {
      connection: getBullMqConnection(),
      concurrency: NOTIFICATIONS_WORKER_CONCURRENCY
    }
  );

  worker.on('completed', (job) => {
    console.log(`[notifications-worker] completed ${job.name}#${job.id}`);
  });
  worker.on('failed', (job, error) => {
    console.error(
      `[notifications-worker] failed ${job?.name ?? 'unknown'}#${job?.id ?? 'n/a'}`,
      error
    );
  });
  worker.on('error', (error) => {
    console.error('[notifications-worker] error', error);
  });

  console.log(`[notifications-worker] started concurrency=${NOTIFICATIONS_WORKER_CONCURRENCY}`);

  const shutdown = async (): Promise<void> => {
    await worker.close();
  };
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
}

async function processDeliveryJob(job: Job<DeliverPushJobData, void, string>): Promise<void> {
  if (job.name !== DELIVER_PUSH_JOB) {
    throw new Error(`Unsupported notifications-delivery job: ${job.name}`);
  }
  const { userId, notification } = job.data;
  if (typeof userId !== 'number' || !notification || typeof notification.id !== 'number') {
    throw new Error(`invalid deliver-push payload: ${JSON.stringify(job.data)}`);
  }
  // Payload carries the full notification — no DB round-trip needed.
  // Notification rows are effectively immutable post-create (only read_at
  // changes, which the push doesn't use), so reading at job time would
  // not return anything fresher than what the enqueue captured.
  await sendPushToUser(userId, notification);
}
