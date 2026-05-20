import path from 'path';
import type { AuthLogEntry } from '../../../shared/types';
import { createDomainLogger } from './domain-logger';
import { createMessageLogStore } from './message-log-store';

const MAX_AUTH_LOGS = 500;
const LOG_DIR = process.env.DB_DIR || '/data';
const LOG_PATH = process.env.AUTH_LOG_PATH || path.join(LOG_DIR, 'auth.log');

const authLogStore = createMessageLogStore<AuthLogEntry>({
  maxEntries: MAX_AUTH_LOGS,
  logPath: LOG_PATH,
  name: 'auth-log'
});

export const authLogger = createDomainLogger('auth', authLogStore.log);

export function listAuthLogs(): AuthLogEntry[] {
  return authLogStore.list();
}

export function getAuthLogCapacity(): number {
  return authLogStore.getCapacity();
}

export function getAuthLogPath(): string {
  return authLogStore.getPath();
}

export function subscribeAuthLogs(listener: () => void): () => void {
  return authLogStore.subscribe(listener);
}
