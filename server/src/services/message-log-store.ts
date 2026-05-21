import fs from 'fs';
import path from 'path';
import { createDomainLogger, type DomainLogger } from './domain-logger';

export const DEFAULT_LOG_DIR = process.env.DB_DIR || '/data';

export interface MessageLogEntry {
  ts: number;
  message: string;
}

interface MessageLogStoreOptions<T extends MessageLogEntry> {
  maxEntries: number;
  logPath: string;
  name: string;
  toEntry?: (message: string) => T;
}

export interface MessageLogStore<T extends MessageLogEntry> {
  log: (message: string) => void;
  list: () => T[];
  getCapacity: () => number;
  getPath: () => string;
  subscribe: (listener: () => void) => () => void;
}

export interface TypedLogService<T extends MessageLogEntry> {
  logger: DomainLogger;
  list: () => T[];
  getCapacity: () => number;
  getPath: () => string;
  subscribe: (listener: () => void) => () => void;
}

export function createTypedLogService<T extends MessageLogEntry>(options: {
  domain: string;
  storeName: string;
  logPath: string;
  maxEntries: number;
}): TypedLogService<T> {
  const store = createMessageLogStore<T>({
    maxEntries: options.maxEntries,
    logPath: options.logPath,
    name: options.storeName
  });
  return {
    logger: createDomainLogger(options.domain, store.log),
    list: () => store.list(),
    getCapacity: () => store.getCapacity(),
    getPath: () => store.getPath(),
    subscribe: (listener) => store.subscribe(listener)
  };
}

export function createMessageLogStore<T extends MessageLogEntry>(
  options: MessageLogStoreOptions<T>
): MessageLogStore<T> {
  const listeners = new Set<() => void>();
  const toEntry = options.toEntry ?? ((message: string) => ({ ts: Date.now(), message } as T));

  return {
    log(message: string): void {
      const entry = toEntry(message);

      try {
        fs.mkdirSync(path.dirname(options.logPath), { recursive: true });
        fs.appendFileSync(options.logPath, `${JSON.stringify(entry)}\n`, 'utf8');
        trimLogFile();
        notifyListeners();
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'unknown_write_error';
        console.error(`[${options.name}] write-error path=${options.logPath} detail=${detail}`);
      }
    },

    list(): T[] {
      try {
        const lines = readLogLines();
        return lines
          .map(parseLogLine)
          .filter((entry): entry is T => entry !== null);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'unknown_read_error';
        console.error(`[${options.name}] read-error path=${options.logPath} detail=${detail}`);
        return [];
      }
    },

    getCapacity(): number {
      return options.maxEntries;
    },

    getPath(): string {
      return options.logPath;
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };

  function trimLogFile(): void {
    const lines = readLogLines();
    // Amortize the rewrite cost — only trim when we're 50% over capacity,
    // then back down to capacity. This bounds the file at ~1.5x maxEntries
    // while skipping the O(file size) rewrite on most appends. Under load
    // (playbackLogger fires per stream event) the previous "rewrite every
    // append past capacity" pattern hammered the event loop.
    if (lines.length <= options.maxEntries * 1.5) {
      return;
    }

    fs.writeFileSync(options.logPath, `${lines.slice(-options.maxEntries).join('\n')}\n`, 'utf8');
  }

  function readLogLines(): string[] {
    if (!fs.existsSync(options.logPath)) {
      return [];
    }

    return fs
      .readFileSync(options.logPath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.length > 0);
  }

  function parseLogLine(line: string): T | null {
    try {
      const parsed = JSON.parse(line) as Partial<T>;
      if (typeof parsed.ts !== 'number' || typeof parsed.message !== 'string') {
        return null;
      }
      return parsed as T;
    } catch {
      return null;
    }
  }

  function notifyListeners(): void {
    for (const listener of listeners) {
      listener();
    }
  }
}
