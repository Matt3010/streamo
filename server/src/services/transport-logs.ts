import fs from 'fs';
import path from 'path';
import type { TransportLogEntry } from '../../../shared/types';
import { DEFAULT_LOG_DIR } from './message-log-store';

const MAX_TRANSPORT_LOGS = 500;
const LOG_PATH = process.env.TRANSPORT_LOG_PATH || path.join(DEFAULT_LOG_DIR, 'nginx-playback-access.log');
const listeners = new Set<() => void>();
let watching = false;

export function listTransportLogs(): TransportLogEntry[] {
  try {
    trimTransportLogFile();
    return readTransportLogLines()
      .map(parseTransportLogLine)
      .filter((entry): entry is TransportLogEntry => entry !== null);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown_read_error';
    console.error(`[transport-log] read-error path=${LOG_PATH} detail=${detail}`);
    return [];
  }
}

export function getTransportLogCapacity(): number {
  return MAX_TRANSPORT_LOGS;
}

export function getTransportLogPath(): string {
  return LOG_PATH;
}

export function subscribeTransportLogs(listener: () => void): () => void {
  listeners.add(listener);
  ensureWatcher();

  return () => {
    listeners.delete(listener);
    clearWatcherIfIdle();
  };
}

function ensureWatcher(): void {
  if (watching) {
    return;
  }

  fs.watchFile(LOG_PATH, { interval: 1000 }, () => {
    if (listeners.size === 0) {
      return;
    }

    try {
      trimTransportLogFile();
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown_trim_error';
      console.error(`[transport-log] trim-error path=${LOG_PATH} detail=${detail}`);
    }

    notifyListeners();
  });

  watching = true;
}

function clearWatcherIfIdle(): void {
  if (!watching || listeners.size > 0) {
    return;
  }

  fs.unwatchFile(LOG_PATH);
  watching = false;
}

function trimTransportLogFile(): void {
  const lines = readTransportLogLines();
  if (lines.length <= MAX_TRANSPORT_LOGS) {
    return;
  }

  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.writeFileSync(LOG_PATH, `${lines.slice(-MAX_TRANSPORT_LOGS).join('\n')}\n`, 'utf8');
}

function readTransportLogLines(): string[] {
  if (!fs.existsSync(LOG_PATH)) {
    return [];
  }

  return fs
    .readFileSync(LOG_PATH, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
}

function parseTransportLogLine(line: string): TransportLogEntry | null {
  try {
    const parsed = JSON.parse(line) as Partial<TransportLogEntry>;
    if (
      typeof parsed.ts !== 'string' ||
      typeof parsed.kind !== 'string' ||
      typeof parsed.request_uri !== 'string' ||
      typeof parsed.status !== 'number' ||
      typeof parsed.upstream_status !== 'string' ||
      typeof parsed.upstream_host !== 'string' ||
      typeof parsed.denied_by !== 'string' ||
      typeof parsed.request_time !== 'number' ||
      typeof parsed.upstream_response_time !== 'string'
    ) {
      return null;
    }

    return {
      ts: parsed.ts,
      kind: parsed.kind,
      request_uri: parsed.request_uri,
      status: parsed.status,
      upstream_status: parsed.upstream_status,
      upstream_host: parsed.upstream_host,
      denied_by: parsed.denied_by,
      request_time: parsed.request_time,
      upstream_response_time: parsed.upstream_response_time
    };
  } catch {
    return null;
  }
}

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}
