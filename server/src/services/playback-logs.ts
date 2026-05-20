import path from 'path';
import type { PlaybackLogEntry } from '../../../shared/types';
import { createDomainLogger } from './domain-logger';
import { createMessageLogStore } from './message-log-store';

const MAX_PLAYBACK_LOGS = 500;
const LOG_DIR = process.env.DB_DIR || '/data';
const LOG_PATH = process.env.PLAYBACK_LOG_PATH || path.join(LOG_DIR, 'playback.log');

const playbackLogStore = createMessageLogStore<PlaybackLogEntry>({
  maxEntries: MAX_PLAYBACK_LOGS,
  logPath: LOG_PATH,
  name: 'playback-log'
});

export const playbackLogger = createDomainLogger('playback', playbackLogStore.log);

export function listPlaybackLogs(): PlaybackLogEntry[] {
  return playbackLogStore.list();
}

export function getPlaybackLogCapacity(): number {
  return playbackLogStore.getCapacity();
}

export function getPlaybackLogPath(): string {
  return playbackLogStore.getPath();
}

export function subscribePlaybackLogs(listener: () => void): () => void {
  return playbackLogStore.subscribe(listener);
}
