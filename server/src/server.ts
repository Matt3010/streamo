import http from 'http';
import express from 'express';
import cookieParser from 'cookie-parser';
import { PORT } from './config';
import { initDb } from './db';
import authRoutes from './routes/auth';
import preferencesRoutes from './routes/preferences';
import progressRoutes from './routes/progress';
import historyRoutes from './routes/history';
import watchlistRoutes from './routes/watchlist';
import adminRoutes from './routes/admin';
import playbackRoutes from './routes/playback';
import providerRoutes from './routes/provider';
import notificationsRoutes from './routes/notifications';
import { attachAdminLiveSessions } from './services/admin-live';
import { requireSuperAdmin } from './middleware/auth';
import { getAdminQueuesBoardRouter } from './services/admin-queues-board';
import { assertRedisReady } from './services/redis';
import { attachUserLiveSessions } from './services/user-live';
import {
  startUserNotificationsSubscription,
  startUserWatchlistEventsSubscription
} from './services/user-live';

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Process-liveness probe for the docker-compose healthcheck. Intentionally
// minimal — does not touch DB or Redis (those have their own healthchecks),
// so a transient upstream blip won't restart the API.
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use(authRoutes);
app.use(preferencesRoutes);
app.use(progressRoutes);
app.use(historyRoutes);
app.use('/admin/queues', requireSuperAdmin, getAdminQueuesBoardRouter());
app.use(watchlistRoutes);
app.use(adminRoutes);
app.use(playbackRoutes);
app.use(providerRoutes);
app.use(notificationsRoutes);

async function start(): Promise<void> {
  await initDb();
  await assertRedisReady();

  const server = http.createServer(app);
  attachAdminLiveSessions(server);
  attachUserLiveSessions(server);
  startUserWatchlistEventsSubscription();
  startUserNotificationsSubscription();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend listening on ${PORT}`);
  });
}

void start().catch((error) => {
  console.error('[server] fatal startup error', error);
  process.exit(1);
});
