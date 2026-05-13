import { startWatchlistWorker } from './services/watchlist-worker';

void startWatchlistWorker().catch((error) => {
  console.error('[worker] fatal', error);
  process.exit(1);
});
