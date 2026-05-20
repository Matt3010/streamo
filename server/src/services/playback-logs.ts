import path from 'path';
import type { PlaybackLogEntry } from '../../../shared/types';
import { DEFAULT_LOG_DIR, createTypedLogService } from './message-log-store';

const LOG_PATH = process.env.PLAYBACK_LOG_PATH || path.join(DEFAULT_LOG_DIR, 'playback.log');

const service = createTypedLogService<PlaybackLogEntry>({
  domain: 'playback',
  storeName: 'playback-log',
  logPath: LOG_PATH,
  maxEntries: 500
});

export const playbackLogger = service.logger;
export const listPlaybackLogs = service.list;
export const getPlaybackLogCapacity = service.getCapacity;
export const getPlaybackLogPath = service.getPath;
export const subscribePlaybackLogs = service.subscribe;
