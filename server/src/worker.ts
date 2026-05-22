import { initDb } from './db';
import { startWatchlistWorker } from './services/watchlist-worker';
import { startNotificationsWorker } from './services/notifications-worker';

void (async () => {
  try {
    await initDb();
    // Both workers share this process. Independent queues / concurrency
    // so an FCM stall can't back up the TMDB-bound watchlist refresh
    // jobs, and a TMDB outage can't slow notification delivery.
    await Promise.all([
      startWatchlistWorker(),
      startNotificationsWorker()
    ]);
  } catch (error) {
    console.error('[worker] fatal', error);
    process.exit(1);
  }
})();
