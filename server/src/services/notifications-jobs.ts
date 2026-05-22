import { Queue } from 'bullmq';
import { getBullMqConnection, hasRedisConfig } from './redis';
import { sendPushToUser } from './fcm';
import type { NotificationItem } from '../../../shared/types';

export const NOTIFICATIONS_DELIVERY_QUEUE_NAME = 'notifications-delivery';
export const DELIVER_PUSH_JOB = 'deliver-push';

export interface DeliverPushJobData {
  userId: number;
  notification: NotificationItem;
}

let queue: Queue<DeliverPushJobData, void, string> | null = null;

function getDeliveryQueue(): Queue<DeliverPushJobData, void, string> | null {
  if (!hasRedisConfig()) return null;
  if (!queue) {
    queue = new Queue<DeliverPushJobData, void, string>(NOTIFICATIONS_DELIVERY_QUEUE_NAME, {
      connection: getBullMqConnection(),
      defaultJobOptions: {
        // Three tries with exponential backoff. FCM transient 5xx / quota
        // hits usually clear within seconds; permanent failures
        // (registration-token-not-registered, mismatched-credential) are
        // already drained in pruneInvalidTokens before they get a chance
        // to fail the job, so attempts past 3 would just be noise.
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 3600, count: 200 },
        removeOnFail: { age: 86400, count: 500 }
      }
    });
  }
  return queue;
}

// Single entry point for "deliver this notification via push". When Redis
// is configured the job is queued (retry/backoff/dead-letter handled by
// BullMQ). When it isn't (local dev / tests) we fall back to an inline
// fire-and-forget send so the developer flow doesn't depend on a
// background worker being up.
export async function enqueuePushDelivery(userId: number, notification: NotificationItem): Promise<void> {
  const q = getDeliveryQueue();
  if (!q) {
    await sendPushToUser(userId, notification);
    return;
  }
  await q.add(
    DELIVER_PUSH_JOB,
    { userId, notification },
    {
      // jobId on the notification PK so accidental double-enqueues
      // (worker re-runs, retried HTTP handlers, etc.) coalesce into a
      // single delivery attempt.
      jobId: `deliver-${notification.id}`
    }
  );
}
