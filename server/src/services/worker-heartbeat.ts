import os from 'os';
import type IORedis from 'ioredis';
import { createRedisClient, hasRedisConfig } from './redis';
import type { AdminQueueWorkerHeartbeat } from '../../../shared/types';

const HEARTBEAT_KEY_PREFIX = 'streamo:worker-heartbeat';
const HEARTBEAT_INTERVAL_MS = 15000;
const HEARTBEAT_TTL_SECONDS = 45;

export function startWorkerHeartbeat(): (() => void) | null {
  if (!hasRedisConfig()) return null;

  const client = createRedisClient();
  const hostname = os.hostname();
  const pid = process.pid;
  const workerId = `${hostname}-${pid}`;
  const key = `${HEARTBEAT_KEY_PREFIX}:${workerId}`;
  const startedAt = Math.floor(Date.now() / 1000);

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const writeHeartbeat = async (): Promise<void> => {
    if (stopped) return;

    const payload = JSON.stringify({
      worker_id: workerId,
      pid,
      hostname,
      started_at: startedAt,
      last_seen_at: Math.floor(Date.now() / 1000)
    });

    await client.set(key, payload, 'EX', HEARTBEAT_TTL_SECONDS);
  };

  const scheduleNext = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      void writeHeartbeat()
        .catch((error) => {
          console.error('[worker-heartbeat]', error);
        })
        .finally(() => {
          scheduleNext();
        });
    }, HEARTBEAT_INTERVAL_MS);
  };

  void writeHeartbeat()
    .catch((error) => {
      console.error('[worker-heartbeat]', error);
    })
    .finally(() => {
      scheduleNext();
    });

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    void client.del(key).catch(() => {}).finally(() => {
      client.disconnect();
    });
  };
}

export async function listWorkerHeartbeats(redis: IORedis): Promise<AdminQueueWorkerHeartbeat[]> {
  const keys = await redis.keys(`${HEARTBEAT_KEY_PREFIX}:*`);
  if (keys.length === 0) return [];

  const pipeline = redis.pipeline();
  for (const key of keys) {
    pipeline.get(key);
    pipeline.ttl(key);
  }
  const results = await pipeline.exec();
  if (!results) return [];

  const heartbeats: AdminQueueWorkerHeartbeat[] = [];
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const getResult = results[i * 2];
    const ttlResult = results[(i * 2) + 1];
    if (!getResult || !ttlResult) continue;
    if (getResult[0] || ttlResult[0]) continue;

    const payload = getResult[1];
    const ttl = ttlResult[1];
    if (typeof payload !== 'string' || typeof ttl !== 'number' || ttl < 0) continue;

    try {
      const parsed = JSON.parse(payload) as Omit<AdminQueueWorkerHeartbeat, 'key' | 'ttl_seconds'>;
      heartbeats.push({
        key,
        worker_id: parsed.worker_id,
        pid: parsed.pid,
        hostname: parsed.hostname,
        started_at: parsed.started_at,
        last_seen_at: parsed.last_seen_at,
        ttl_seconds: ttl
      });
    } catch {
      // Ignore malformed heartbeat entries.
    }
  }

  return heartbeats.sort((a, b) => a.worker_id.localeCompare(b.worker_id));
}
