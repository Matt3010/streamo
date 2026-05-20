import path from 'path';
import type { AuthLogEntry } from '../../../shared/types';
import { DEFAULT_LOG_DIR, createTypedLogService } from './message-log-store';

const LOG_PATH = process.env.AUTH_LOG_PATH || path.join(DEFAULT_LOG_DIR, 'auth.log');

const service = createTypedLogService<AuthLogEntry>({
  domain: 'auth',
  storeName: 'auth-log',
  logPath: LOG_PATH,
  maxEntries: 500
});

export const authLogger = service.logger;
export const listAuthLogs = service.list;
export const getAuthLogCapacity = service.getCapacity;
export const getAuthLogPath = service.getPath;
export const subscribeAuthLogs = service.subscribe;
