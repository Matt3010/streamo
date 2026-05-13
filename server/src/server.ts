import http from 'http';
import express from 'express';
import cookieParser from 'cookie-parser';
import { PORT } from './config';
import authRoutes from './routes/auth';
import preferencesRoutes from './routes/preferences';
import progressRoutes from './routes/progress';
import historyRoutes from './routes/history';
import watchlistRoutes from './routes/watchlist';
import adminRoutes from './routes/admin';
import playbackRoutes from './routes/playback';
import { attachAdminLiveSessions } from './services/admin-live';
import { attachUserLiveSessions } from './services/user-live';
import { startWatchlistRefreshLoop } from './services/watchlist-refresh';

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.use(authRoutes);
app.use(preferencesRoutes);
app.use(progressRoutes);
app.use(historyRoutes);
app.use(watchlistRoutes);
app.use(adminRoutes);
app.use(playbackRoutes);

const server = http.createServer(app);
attachAdminLiveSessions(server);
attachUserLiveSessions(server);
startWatchlistRefreshLoop();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend listening on ${PORT}`);
});
