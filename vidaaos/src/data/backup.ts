// Port of BackupManager.kt. JSON export/import of watchlist + progress + history.
import { db, type WatchlistEntry, type ProgressEntry, type HistoryEntry } from './db';

export interface BackupPayload {
  watchlist: WatchlistEntry[];
  progress: ProgressEntry[];
  history: HistoryEntry[];
}

export async function exportBackup(): Promise<BackupPayload> {
  const [watchlist, progress, history] = await Promise.all([
    db.watchlist.toArray(),
    db.progress.toArray(),
    db.history.toArray(),
  ]);
  return { watchlist, progress, history };
}

export async function importBackup(payload: BackupPayload): Promise<void> {
  await db.transaction('rw', db.watchlist, db.progress, db.history, async () => {
    await Promise.all([db.watchlist.clear(), db.progress.clear(), db.history.clear()]);
    if (payload.watchlist?.length) await db.watchlist.bulkPut(payload.watchlist);
    if (payload.progress?.length) await db.progress.bulkPut(payload.progress);
    if (payload.history?.length) await db.history.bulkPut(payload.history);
  });
}