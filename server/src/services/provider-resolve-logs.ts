import path from 'path';
import type { ProviderResolveLogEntry } from '../../../shared/types';
import { DEFAULT_LOG_DIR, createTypedLogService } from './message-log-store';

const LOG_PATH = process.env.PROVIDER_RESOLVE_LOG_PATH || path.join(DEFAULT_LOG_DIR, 'provider-resolve.log');

const service = createTypedLogService<ProviderResolveLogEntry>({
  domain: 'provider-resolver',
  storeName: 'provider-resolve-log',
  logPath: LOG_PATH,
  maxEntries: 500
});

export const providerResolveLogger = service.logger;
export const listProviderResolveLogs = service.list;
export const getProviderResolveLogCapacity = service.getCapacity;
export const getProviderResolveLogPath = service.getPath;
export const subscribeProviderResolveLogs = service.subscribe;
