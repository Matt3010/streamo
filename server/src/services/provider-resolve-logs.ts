import path from 'path';
import type { ProviderResolveLogEntry } from '../../../shared/types';
import { createDomainLogger } from './domain-logger';
import { createMessageLogStore } from './message-log-store';

const MAX_PROVIDER_RESOLVE_LOGS = 500;
const LOG_DIR = process.env.DB_DIR || '/data';
const LOG_PATH = process.env.PROVIDER_RESOLVE_LOG_PATH || path.join(LOG_DIR, 'provider-resolve.log');

const providerResolveLogStore = createMessageLogStore<ProviderResolveLogEntry>({
  maxEntries: MAX_PROVIDER_RESOLVE_LOGS,
  logPath: LOG_PATH,
  name: 'provider-resolve-log'
});

export const providerResolveLogger = createDomainLogger('provider-resolver', providerResolveLogStore.log);

export function listProviderResolveLogs(): ProviderResolveLogEntry[] {
  return providerResolveLogStore.list();
}

export function getProviderResolveLogCapacity(): number {
  return providerResolveLogStore.getCapacity();
}

export function getProviderResolveLogPath(): string {
  return providerResolveLogStore.getPath();
}

export function subscribeProviderResolveLogs(listener: () => void): () => void {
  return providerResolveLogStore.subscribe(listener);
}
