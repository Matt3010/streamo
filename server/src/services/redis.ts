import type { ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { REDIS_URL } from '../config';

let publisher: IORedis | null = null;
const REDIS_PING_TIMEOUT_MS = 5000;

export function hasRedisConfig(): boolean {
  return REDIS_URL.length > 0;
}

export function getBullMqConnection(): ConnectionOptions {
  if (!REDIS_URL) {
    throw new Error('REDIS_URL is not configured');
  }

  const url = new URL(REDIS_URL);
  const port = Number(url.port || (url.protocol === 'rediss:' ? 6380 : 6379));
  const db = Number((url.pathname || '/0').replace('/', ''));
  const connection: Record<string, unknown> = {
    host: url.hostname,
    port: Number.isFinite(port) ? port : 6379,
    db: Number.isFinite(db) ? db : 0
  };

  if (url.username) connection['username'] = decodeURIComponent(url.username);
  if (url.password) connection['password'] = decodeURIComponent(url.password);
  if (url.protocol === 'rediss:') connection['tls'] = {};

  return connection as ConnectionOptions;
}

export function createRedisClient(): IORedis {
  if (!REDIS_URL) {
    throw new Error('REDIS_URL is not configured');
  }
  return new IORedis(REDIS_URL);
}

export function getRedisPublisher(): IORedis {
  if (!publisher) {
    publisher = createRedisClient();
    publisher.on('error', (error) => {
      console.error('[redis-publisher]', error);
    });
  }
  return publisher;
}

// Scoped helper: open a one-shot client, run the callback, always
// disconnect — used by queue-status, admin-health, and anywhere else
// that just needs to issue a handful of commands without holding a
// long-lived connection.
export async function withRedisClient<T>(fn: (redis: IORedis) => Promise<T>): Promise<T> {
  const redis = createRedisClient();
  try {
    return await fn(redis);
  } finally {
    redis.disconnect();
  }
}

export async function assertRedisReady(): Promise<void> {
  if (!hasRedisConfig()) {
    throw new Error('REDIS_URL is not configured');
  }

  const client = createRedisClient();
  try {
    const ping = client.ping();
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Redis ping timed out after ${REDIS_PING_TIMEOUT_MS}ms`)), REDIS_PING_TIMEOUT_MS);
    });
    await Promise.race([ping, timeout]);
  } finally {
    client.disconnect();
  }
}
