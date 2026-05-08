import express from 'express';
import cookieParser from 'cookie-parser';
import { PORT } from './config';
import authRoutes from './routes/auth';
import preferencesRoutes from './routes/preferences';
import progressRoutes from './routes/progress';
import historyRoutes from './routes/history';
import watchlistRoutes from './routes/watchlist';
import adminRoutes from './routes/admin';

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend listening on ${PORT}`);
});
