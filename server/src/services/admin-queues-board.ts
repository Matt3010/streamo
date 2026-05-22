import type { RequestHandler } from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { getWatchlistQueue } from './watchlist-jobs';
import { getNotificationsDeliveryQueue } from './notifications-jobs';

const BOARD_BASE_PATH = '/api/admin/queues';

let router: RequestHandler | null = null;

export function getAdminQueuesBoardRouter(): RequestHandler {
  if (router) return router;

  const watchlistQueue = getWatchlistQueue();
  const notificationsQueue = getNotificationsDeliveryQueue();
  const queues = [watchlistQueue, notificationsQueue].filter((q): q is NonNullable<typeof q> => q !== null);

  if (queues.length === 0) {
    router = (_req, res) => {
      res.status(503).send('BullMQ dashboard unavailable: Redis queue is not configured.');
    };
    return router;
  }

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BOARD_BASE_PATH);

  createBullBoard({
    queues: queues.map((q) => new BullMQAdapter(q, { readOnlyMode: false })),
    serverAdapter,
    options: {
      uiConfig: {
        boardTitle: 'Streamo Queue Dashboard',
        hideRedisDetails: true
      }
    }
  });

  const boardRouter = serverAdapter.getRouter();
  router = boardRouter;
  return boardRouter;
}
