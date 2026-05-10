import fs from 'fs';
import path from 'path';
import type { PlaybackLogEntry } from '../../../shared/types';

const MAX_PLAYBACK_LOGS = 500;
const LOG_DIR = process.env.DB_DIR || '/data';
const LOG_PATH = process.env.PLAYBACK_LOG_PATH || path.join(LOG_DIR, 'playback.log');
const listeners = new Set<() => void>();

export function logPlayback(message: string): void {
  const entry: PlaybackLogEntry = {
    ts: Date.now(),
    message
  };

  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
    trimPlaybackLogFile();
    notifyPlaybackLogListeners();
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown_write_error';
    console.error(`[playback-log] write-error path=${LOG_PATH} detail=${detail}`);
  }

  console.log(message);
}

export function listPlaybackLogs(): PlaybackLogEntry[] {
  try {
    const lines = readPlaybackLogLines();
    return lines
      .map(parsePlaybackLogLine)
      .filter((entry): entry is PlaybackLogEntry => entry !== null);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown_read_error';
    console.error(`[playback-log] read-error path=${LOG_PATH} detail=${detail}`);
    return [];
  }
}

export function getPlaybackLogCapacity(): number {
  return MAX_PLAYBACK_LOGS;
}

export function getPlaybackLogPath(): string {
  return LOG_PATH;
}

export function subscribePlaybackLogs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function trimPlaybackLogFile(): void {
  const lines = readPlaybackLogLines();
  if (lines.length <= MAX_PLAYBACK_LOGS) {
    return;
  }

  fs.writeFileSync(LOG_PATH, `${lines.slice(-MAX_PLAYBACK_LOGS).join('\n')}\n`, 'utf8');
}

function readPlaybackLogLines(): string[] {
  if (!fs.existsSync(LOG_PATH)) {
    return [];
  }

  return fs
    .readFileSync(LOG_PATH, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
}

function parsePlaybackLogLine(line: string): PlaybackLogEntry | null {
  try {
    const parsed = JSON.parse(line) as Partial<PlaybackLogEntry>;
    if (typeof parsed.ts !== 'number' || typeof parsed.message !== 'string') {
      return null;
    }
    return { ts: parsed.ts, message: parsed.message };
  } catch {
    return null;
  }
}

function notifyPlaybackLogListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}
