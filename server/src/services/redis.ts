import type { ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { REDIS_URL } from '../config';

let publisher: IORedis | null = null;

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
