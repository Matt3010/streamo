const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { promisify } = require('node:util');
const db = require('./db');
const { getOrCreateJwtSecret } = require('./db');

const bcryptHash = promisify(bcrypt.hash);
const bcryptCompare = promisify(bcrypt.compare);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || getOrCreateJwtSecret();
const TOKEN_TTL = 60 * 60 * 24 * 30; // 30 days
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production';
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const TMDB_CACHE_TTL = 24 * 60 * 60; // 24 hours
// Episodes/movies count as "watched" once you've seen at least this fraction.
const WATCHED_THRESHOLD = 0.8;
// "Continua a guardare" hides items only when they're effectively complete —
// otherwise pausing at 80% to grab a coffee would yank the title out of your
// resume queue.
const CONTINUE_HIDE_THRESHOLD = 0.95;

// Fetches a TV show's headline counts from TMDB, with a 24h SQLite cache.
// Returns { number_of_seasons, number_of_episodes, seasons } or null on failure.
async function getTmdbTvSummary(tmdbId) {
  const key = `tv:${tmdbId}`;
  const now = Math.floor(Date.now() / 1000);
  const cached = db.prepare('SELECT data, fetched_at FROM tmdb_cache WHERE cache_key = ?').get(key);
  if (cached && (now - cached.fetched_at) < TMDB_CACHE_TTL) {
    try {
      const parsed = JSON.parse(cached.data);
      // Old cache entries may lack `seasons` — fall through to refetch.
      if (Array.isArray(parsed.seasons)) return parsed;
    } catch { /* fall through */ }
  }
  if (!TMDB_API_KEY) return null;
  try {
    const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?language=it-IT&api_key=${TMDB_API_KEY}`);
    if (!res.ok) return null;
    const data = await res.json();
    const stored = {
      number_of_seasons: data.number_of_seasons || 0,
      number_of_episodes: data.number_of_episodes || 0,
      seasons: (data.seasons || [])
        .filter(s => s.season_number > 0)
        .map(s => ({ season_number: s.season_number, episode_count: s.episode_count || 0 }))
    };
    db.prepare('INSERT OR REPLACE INTO tmdb_cache (cache_key, data, fetched_at) VALUES (?, ?, ?)').run(key, JSON.stringify(stored), now);
    return stored;
  } catch {
    return null;
  }
}

app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// --- Rate limiters ---
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_attempts' }
});

// --- Helpers ---
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toInt(v, { min = -Infinity, max = Infinity } = {}) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

// --- Auth middleware ---
function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'unauthenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'invalid_token' });
  }
}

function setAuthCookie(res, user) {
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: TOKEN_TTL
  });
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: TOKEN_TTL * 1000,
    path: '/'
  });
}

// --- Auth routes ---
app.post('/auth/register', authLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'missing_fields' });
  if (email.length > 254 || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid_email' });
  if (password.length < 6) return res.status(400).json({ error: 'weak_password' });

  const normalized = email.trim().toLowerCase();
  try {
    const hash = await bcryptHash(password, 10);
    const info = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(normalized, hash);
    const user = { id: info.lastInsertRowid, email: normalized, autoplay_next: 1 };
    setAuthCookie(res, user);
    res.json({ user });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'email_taken' });
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'missing_fields' });

  const normalized = email.trim().toLowerCase();
  const row = db.prepare('SELECT id, email, password_hash, autoplay_next FROM users WHERE email = ?').get(normalized);
  if (!row || !(await bcryptCompare(password, row.password_hash))) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  const user = { id: row.id, email: row.email, autoplay_next: row.autoplay_next };
  setAuthCookie(res, user);
  res.json({ user });
});

app.post('/auth/logout', (req, res) => {
  res.clearCookie('token', { path: '/' });
  res.json({ ok: true });
});

app.get('/auth/me', requireAuth, (req, res) => {
  const row = db.prepare('SELECT autoplay_next FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: { id: req.user.id, email: req.user.email, autoplay_next: row ? row.autoplay_next : 1 } });
});

// --- Preferences ---
app.put('/user/preferences', requireAuth, (req, res) => {
  const { autoplay_next } = req.body || {};
  if (autoplay_next !== 0 && autoplay_next !== 1) return res.status(400).json({ error: 'invalid_value' });
  db.prepare('UPDATE users SET autoplay_next = ? WHERE id = ?').run(autoplay_next, req.user.id);
  res.json({ ok: true, autoplay_next });
});

// --- Progress routes ---
app.post('/user/progress', requireAuth, async (req, res) => {
  const body = req.body || {};
  const tmdb_id = toInt(body.tmdb_id, { min: 1 });
  const media_type = body.media_type;
  const season = toInt(body.season ?? 0, { min: 0 }) ?? 0;
  const episode = toInt(body.episode ?? 0, { min: 0 }) ?? 0;
  const position = Number(body.position);
  const durationRaw = Number(body.duration ?? 0);
  const duration = Number.isFinite(durationRaw) ? durationRaw : 0;

  if (!tmdb_id || !media_type || !Number.isFinite(position)) return res.status(400).json({ error: 'missing_fields' });
  if (!['movie', 'tv'].includes(media_type)) return res.status(400).json({ error: 'invalid_type' });

  db.prepare(`
    INSERT INTO progress (user_id, tmdb_id, media_type, season, episode, position, duration, title, poster, backdrop, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))
    ON CONFLICT(user_id, tmdb_id, media_type, season, episode) DO UPDATE SET
      position = excluded.position,
      duration = excluded.duration,
      title = COALESCE(excluded.title, title),
      poster = COALESCE(excluded.poster, poster),
      backdrop = COALESCE(excluded.backdrop, backdrop),
      updated_at = strftime('%s','now')
  `).run(req.user.id, tmdb_id, media_type, season, episode, position, duration,
         body.title || null, body.poster || null, body.backdrop || null);

  // Auto-flip watchlist status to 'done' when the user has effectively
  // finished the title via real playback. Only flips upward (todo → done);
  // never overrides an explicit 'done' back to 'todo' here.
  await maybeAutoCompleteWatchlist(req.user.id, tmdb_id, media_type);

  res.json({ ok: true });
});

async function maybeAutoCompleteWatchlist(userId, tmdbId, mediaType) {
  const wl = db.prepare(`
    SELECT status FROM watchlist
    WHERE user_id = ? AND tmdb_id = ? AND media_type = ?
  `).get(userId, tmdbId, mediaType);
  if (!wl || wl.status === 'done') return;

  if (mediaType === 'movie') {
    const row = db.prepare(`
      SELECT position, duration FROM progress
      WHERE user_id = ? AND tmdb_id = ? AND media_type = 'movie' AND season = 0 AND episode = 0
    `).get(userId, tmdbId);
    if (row && row.duration > 0 && row.position >= row.duration * WATCHED_THRESHOLD) {
      db.prepare(`UPDATE watchlist SET status = 'done' WHERE user_id = ? AND tmdb_id = ? AND media_type = 'movie'`)
        .run(userId, tmdbId);
    }
    return;
  }

  // TV: need TMDB total_episodes to decide.
  const summary = await getTmdbTvSummary(tmdbId);
  const totalEp = summary?.number_of_episodes ?? 0;
  if (!totalEp) return;
  const cnt = db.prepare(`
    SELECT SUM(CASE WHEN duration > 0 AND position >= duration * ${WATCHED_THRESHOLD} THEN 1 ELSE 0 END) AS watched
    FROM progress
    WHERE user_id = ? AND tmdb_id = ? AND media_type = 'tv'
  `).get(userId, tmdbId);
  if ((cnt?.watched ?? 0) >= totalEp) {
    db.prepare(`UPDATE watchlist SET status = 'done' WHERE user_id = ? AND tmdb_id = ? AND media_type = 'tv'`)
      .run(userId, tmdbId);
  }
}

app.get('/user/progress', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT p.tmdb_id, p.media_type, p.season, p.episode, p.position, p.duration,
           p.title, p.poster, p.backdrop, MAX(p.updated_at) AS updated_at
    FROM progress p
    WHERE p.user_id = ?
      AND p.position > 5
      AND (p.duration = 0 OR p.position < p.duration * ${CONTINUE_HIDE_THRESHOLD})
      AND NOT EXISTS (
        SELECT 1 FROM watchlist w
        WHERE w.user_id = p.user_id
          AND w.tmdb_id = p.tmdb_id
          AND w.media_type = p.media_type
          AND w.status = 'done'
      )
    GROUP BY p.tmdb_id, p.media_type
    ORDER BY updated_at DESC
    LIMIT 30
  `).all(req.user.id);
  res.json({ items: rows });
});

// "Da dove ero rimasto" — returns the most recently updated progress row.
// If none, returns null and the frontend falls back to S1E1.
// Tiebreakers (season DESC, episode DESC) ensure that "L'ho visto tutto"
// (which inserts many rows in the same second) resumes on the finale rather
// than on an arbitrary middle episode.
app.get('/user/progress/next/:type/:tmdb_id', requireAuth, (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const type = req.params.type;
  if (!tmdb_id || type !== 'tv') return res.status(400).json({ error: 'invalid_params' });

  const last = db.prepare(`
    SELECT season, episode FROM progress
    WHERE user_id = ? AND tmdb_id = ? AND media_type = 'tv'
    ORDER BY updated_at DESC, season DESC, episode DESC
    LIMIT 1
  `).get(req.user.id, tmdb_id);

  res.json({ next: last ? { season: last.season, episode: last.episode } : null });
});

app.get('/user/progress/:type/:tmdb_id/:season?/:episode?', requireAuth, (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const season = toInt(req.params.season ?? 0, { min: 0 }) ?? 0;
  const episode = toInt(req.params.episode ?? 0, { min: 0 }) ?? 0;
  const type = req.params.type;
  if (!tmdb_id || !['movie', 'tv'].includes(type)) return res.status(400).json({ error: 'invalid_params' });

  const row = db.prepare(`
    SELECT position, duration FROM progress
    WHERE user_id = ? AND tmdb_id = ? AND media_type = ? AND season = ? AND episode = ?
  `).get(req.user.id, tmdb_id, type, season, episode);
  res.json({ progress: row || null });
});

app.delete('/user/progress/:type/:tmdb_id/:season?/:episode?', requireAuth, (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const season = toInt(req.params.season ?? 0, { min: 0 }) ?? 0;
  const episode = toInt(req.params.episode ?? 0, { min: 0 }) ?? 0;
  const type = req.params.type;
  if (!tmdb_id || !['movie', 'tv'].includes(type)) return res.status(400).json({ error: 'invalid_params' });

  db.prepare(`
    DELETE FROM progress WHERE user_id = ? AND tmdb_id = ? AND media_type = ? AND season = ? AND episode = ?
  `).run(req.user.id, tmdb_id, type, season, episode);
  res.json({ ok: true });
});

// --- History routes ---
app.post('/user/history', requireAuth, (req, res) => {
  const body = req.body || {};
  const tmdb_id = toInt(body.tmdb_id, { min: 1 });
  const media_type = body.media_type;
  const season = toInt(body.season ?? 0, { min: 0 }) ?? 0;
  const episode = toInt(body.episode ?? 0, { min: 0 }) ?? 0;

  if (!tmdb_id || !media_type) return res.status(400).json({ error: 'missing_fields' });
  if (!['movie', 'tv'].includes(media_type)) return res.status(400).json({ error: 'invalid_type' });

  db.prepare(`
    INSERT INTO history (user_id, tmdb_id, media_type, season, episode, title, poster, watched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))
    ON CONFLICT(user_id, tmdb_id, media_type, season, episode) DO UPDATE SET
      title = COALESCE(excluded.title, title),
      poster = COALESCE(excluded.poster, poster),
      watched_at = strftime('%s','now')
  `).run(req.user.id, tmdb_id, media_type, season, episode, body.title || null, body.poster || null);
  res.json({ ok: true });
});

app.get('/user/history', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT tmdb_id, media_type, season, episode, title, poster, MAX(watched_at) as watched_at
    FROM history
    WHERE user_id = ?
    GROUP BY tmdb_id, media_type
    ORDER BY watched_at DESC
    LIMIT 50
  `).all(req.user.id);
  res.json({ items: rows });
});

app.delete('/user/history', requireAuth, (req, res) => {
  db.prepare('DELETE FROM history WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

app.delete('/user/history/:type/:tmdb_id', requireAuth, (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const type = req.params.type;
  if (!tmdb_id || !['movie', 'tv'].includes(type)) return res.status(400).json({ error: 'invalid_params' });
  // Drop every history row for this title (the GET groups by tmdb_id+type so
  // a single visible card may correspond to several physical rows).
  db.prepare(`
    DELETE FROM history WHERE user_id = ? AND tmdb_id = ? AND media_type = ?
  `).run(req.user.id, tmdb_id, type);
  res.json({ ok: true });
});

// --- Watchlist routes ---
app.post('/user/watchlist', requireAuth, (req, res) => {
  const body = req.body || {};
  const tmdb_id = toInt(body.tmdb_id, { min: 1 });
  const media_type = body.media_type;
  if (!tmdb_id || !media_type) return res.status(400).json({ error: 'missing_fields' });
  if (!['movie', 'tv'].includes(media_type)) return res.status(400).json({ error: 'invalid_type' });
  db.prepare(`
    INSERT OR IGNORE INTO watchlist (user_id, tmdb_id, media_type, title, poster)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.user.id, tmdb_id, media_type, body.title || null, body.poster || null);
  res.json({ ok: true });
});

app.get('/user/watchlist', requireAuth, async (req, res) => {
  const rows = db.prepare(`
    SELECT tmdb_id, media_type, title, poster, status, added_at
    FROM watchlist WHERE user_id = ?
    ORDER BY added_at DESC
  `).all(req.user.id);

  // Latest in-flight progress row per item — drives the percentage bar on the
  // watchlist card. We exclude rows that are essentially complete so a finished
  // movie doesn't show a 100%-full bar.
  const latestProgress = new Map();
  if (rows.length > 0) {
    const latestRows = db.prepare(`
      SELECT tmdb_id, media_type, position, duration FROM (
        SELECT tmdb_id, media_type, position, duration, updated_at,
               ROW_NUMBER() OVER (PARTITION BY tmdb_id, media_type ORDER BY updated_at DESC) AS rn
        FROM progress
        WHERE user_id = ?
      )
      WHERE rn = 1
        AND duration > 0
        AND position > 5
        AND position < duration * ${CONTINUE_HIDE_THRESHOLD}
    `).all(req.user.id);
    for (const p of latestRows) {
      latestProgress.set(`${p.media_type}:${p.tmdb_id}`, { position: p.position, duration: p.duration });
    }
  }

  // Build a per-show progress summary for TV items: max season touched, max
  // episode within that season, and how many episodes count as "watched"
  // (position reached >= WATCHED_THRESHOLD of duration).
  const tvIds = rows.filter(r => r.media_type === 'tv').map(r => r.tmdb_id);
  const progressByTmdb = new Map();
  if (tvIds.length > 0) {
    const placeholders = tvIds.map(() => '?').join(',');
    const seasons = db.prepare(`
      SELECT tmdb_id,
        MAX(season) AS max_season,
        SUM(CASE WHEN duration > 0 AND position >= duration * ${WATCHED_THRESHOLD} THEN 1 ELSE 0 END) AS watched_count
      FROM progress
      WHERE user_id = ? AND media_type = 'tv' AND tmdb_id IN (${placeholders})
      GROUP BY tmdb_id
    `).all(req.user.id, ...tvIds);
    for (const s of seasons) {
      const ep = db.prepare(`
        SELECT MAX(episode) AS max_episode FROM progress
        WHERE user_id = ? AND media_type = 'tv' AND tmdb_id = ? AND season = ?
      `).get(req.user.id, s.tmdb_id, s.max_season);
      progressByTmdb.set(s.tmdb_id, {
        last_season: s.max_season,
        last_episode: ep?.max_episode ?? 0,
        watched_count: s.watched_count
      });
    }
  }

  // Enrich each TV item with progress + TMDB headline counts. Promise.all so
  // cached items return instantly and uncached ones fan out in parallel.
  const items = await Promise.all(rows.map(async r => {
    const inFlight = latestProgress.get(`${r.media_type}:${r.tmdb_id}`);
    if (r.media_type !== 'tv') {
      return inFlight ? { ...r, position: inFlight.position, duration: inFlight.duration } : r;
    }
    const prog = progressByTmdb.get(r.tmdb_id) ?? { last_season: 0, last_episode: 0, watched_count: 0 };
    const tmdb = await getTmdbTvSummary(r.tmdb_id);
    const totalEpisodes = tmdb?.number_of_episodes ?? 0;
    let status = r.status;
    // "L'ho visto tutto" means caught up at that moment — if TMDB now reports
    // more episodes than the user has watched, flip back to 'todo' so the
    // show reappears in the user's queue.
    if (status === 'done' && totalEpisodes > 0 && (prog.watched_count ?? 0) < totalEpisodes) {
      db.prepare(`
        UPDATE watchlist SET status = 'todo'
        WHERE user_id = ? AND tmdb_id = ? AND media_type = 'tv'
      `).run(req.user.id, r.tmdb_id);
      status = 'todo';
    }
    return {
      ...r,
      status,
      last_season: prog.last_season,
      last_episode: prog.last_episode,
      watched_count: prog.watched_count,
      total_seasons: tmdb?.number_of_seasons ?? 0,
      total_episodes: totalEpisodes,
      // Per-season episode counts — used by the manual progress modal to cap
      // the episode input to the actual count for the chosen season.
      seasons: tmdb?.seasons ?? [],
      // Progress of the latest in-flight episode, for the card progress bar.
      ...(inFlight ? { position: inFlight.position, duration: inFlight.duration } : {})
    };
  }));

  res.json({ items });
});

// Manual progress marking for TV shows: insert synthetic progress rows for
// every episode up to and including (season, episode). With { all: true } we
// mark everything and flip the watchlist row to status='done'.
// Existing progress rows are preserved (INSERT OR IGNORE) so real playback
// position isn't overwritten.
app.post('/user/watchlist/:type/:tmdb_id/mark', requireAuth, async (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const type = req.params.type;
  const body = req.body || {};
  const all = body.all === true;
  if (!tmdb_id || type !== 'tv') {
    return res.status(400).json({ error: 'invalid_params' });
  }

  const summary = await getTmdbTvSummary(tmdb_id);
  if (!summary || !Array.isArray(summary.seasons) || summary.seasons.length === 0) {
    return res.status(503).json({ error: 'tmdb_unavailable' });
  }

  let stopSeason = 0;
  let stopEpisode = 0;
  if (all) {
    const last = summary.seasons.reduce((a, b) => b.season_number > a.season_number ? b : a, summary.seasons[0]);
    stopSeason = last.season_number;
    stopEpisode = last.episode_count || 0;
    if (!stopEpisode) return res.status(503).json({ error: 'tmdb_unavailable' });
  } else {
    stopSeason = toInt(body.season, { min: 1 });
    stopEpisode = toInt(body.episode, { min: 1 });
    if (!stopSeason || !stopEpisode) return res.status(400).json({ error: 'invalid_params' });
    const targetSeason = summary.seasons.find(s => s.season_number === stopSeason);
    if (!targetSeason || stopEpisode > (targetSeason.episode_count || 0)) {
      return res.status(400).json({ error: 'invalid_season_or_episode' });
    }
  }

  const insert = db.prepare(`
    INSERT INTO progress (user_id, tmdb_id, media_type, season, episode, position, duration)
    VALUES (?, ?, 'tv', ?, ?, 1, 1)
    ON CONFLICT(user_id, tmdb_id, media_type, season, episode) DO UPDATE SET
      position = MAX(position, duration),
      duration = MAX(duration, 1)
  `);
  const tx = db.transaction(() => {
    // Partial mark = the user is rewinding their declared progress. Drop any
    // rows past the new cutoff so last_season/last_episode + watched_count
    // reflect the lower mark. (Skip for "all" — there's nothing past it.)
    if (!all) {
      db.prepare(`
        DELETE FROM progress
        WHERE user_id = ? AND tmdb_id = ? AND media_type = 'tv'
          AND (season > ? OR (season = ? AND episode > ?))
      `).run(req.user.id, tmdb_id, stopSeason, stopSeason, stopEpisode);
    }
    for (const s of summary.seasons) {
      if (s.season_number > stopSeason) continue;
      const lastEp = s.season_number === stopSeason ? stopEpisode : (s.episode_count || 0);
      for (let ep = 1; ep <= lastEp; ep++) {
        insert.run(req.user.id, tmdb_id, s.season_number, ep);
      }
    }
    // Sync watchlist status with intent: "all" → done; partial mark → todo
    // (the user is saying they haven't finished after all).
    db.prepare(`
      UPDATE watchlist SET status = ?
      WHERE user_id = ? AND tmdb_id = ? AND media_type = 'tv'
    `).run(all ? 'done' : 'todo', req.user.id, tmdb_id);
  });
  tx();
  res.json({ ok: true });
});

app.patch('/user/watchlist/:type/:tmdb_id', requireAuth, async (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const type = req.params.type;
  const status = (req.body || {}).status;
  if (!tmdb_id || !['movie', 'tv'].includes(type)) return res.status(400).json({ error: 'invalid_params' });
  if (!['todo', 'done'].includes(status)) return res.status(400).json({ error: 'invalid_status' });
  const result = db.prepare(`
    UPDATE watchlist SET status = ?
    WHERE user_id = ? AND tmdb_id = ? AND media_type = ?
  `).run(status, req.user.id, tmdb_id, type);
  if (result.changes === 0) return res.status(404).json({ error: 'not_found' });

  // Sync progress with the user's intent:
  //  - status='done' → mark every episode watched (otherwise the badge stays
  //    "Mancano N" even after the user explicitly said they're done).
  //  - status='todo' → wipe progress, otherwise the badge would say
  //    "Sei al passo" inside the "Da guardare" filter (contradiction).
  if (type === 'tv') {
    if (status === 'done') {
      const summary = await getTmdbTvSummary(tmdb_id);
      if (summary?.seasons?.length) {
        const insert = db.prepare(`
          INSERT INTO progress (user_id, tmdb_id, media_type, season, episode, position, duration)
          VALUES (?, ?, 'tv', ?, ?, 1, 1)
          ON CONFLICT(user_id, tmdb_id, media_type, season, episode) DO UPDATE SET
            position = MAX(position, duration),
            duration = MAX(duration, 1)
        `);
        const tx = db.transaction(() => {
          for (const s of summary.seasons) {
            for (let ep = 1; ep <= (s.episode_count || 0); ep++) {
              insert.run(req.user.id, tmdb_id, s.season_number, ep);
            }
          }
        });
        tx();
      }
    } else {
      db.prepare(`
        DELETE FROM progress WHERE user_id = ? AND tmdb_id = ? AND media_type = 'tv'
      `).run(req.user.id, tmdb_id);
    }
  }
  res.json({ ok: true });
});

app.delete('/user/watchlist/:type/:tmdb_id', requireAuth, (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const type = req.params.type;
  if (!tmdb_id || !['movie', 'tv'].includes(type)) return res.status(400).json({ error: 'invalid_params' });
  // Drop the watchlist row + any progress rows for the same item — otherwise
  // re-adding the title would surface stale "watched" data.
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM watchlist WHERE user_id = ? AND tmdb_id = ? AND media_type = ?`).run(req.user.id, tmdb_id, type);
    db.prepare(`DELETE FROM progress WHERE user_id = ? AND tmdb_id = ? AND media_type = ?`).run(req.user.id, tmdb_id, type);
  });
  tx();
  res.json({ ok: true });
});

app.get('/user/watchlist/check/:type/:tmdb_id', requireAuth, (req, res) => {
  const tmdb_id = toInt(req.params.tmdb_id, { min: 1 });
  const type = req.params.type;
  if (!tmdb_id || !['movie', 'tv'].includes(type)) return res.status(400).json({ error: 'invalid_params' });
  const row = db.prepare(`
    SELECT 1 as in_list FROM watchlist
    WHERE user_id = ? AND tmdb_id = ? AND media_type = ?
  `).get(req.user.id, tmdb_id, type);
  res.json({ in_list: !!row });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend listening on ${PORT}`);
});
