import { initDb } from './db';
import { startWatchlistWorker } from './services/watchlist-worker';

void (async () => {
  try {
    await initDb();
    await startWatchlistWorker();
  } catch (error) {
    console.error('[worker] fatal', error);
    process.exit(1);
  }
})();
