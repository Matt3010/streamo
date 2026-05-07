const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DB_DIR = process.env.DB_DIR || '/data';
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'vixstream.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    autoplay_next INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS progress (
    user_id INTEGER NOT NULL,
    tmdb_id INTEGER NOT NULL,
    media_type TEXT NOT NULL,
    season INTEGER NOT NULL DEFAULT 0,
    episode INTEGER NOT NULL DEFAULT 0,
    position REAL NOT NULL,
    duration REAL NOT NULL DEFAULT 0,
    title TEXT,
    poster TEXT,
    backdrop TEXT,
    updated_at INTEGER DEFAULT (strftime('%s','now')),
    PRIMARY KEY (user_id, tmdb_id, media_type, season, episode),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_progress_user_updated ON progress(user_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    tmdb_id INTEGER NOT NULL,
    media_type TEXT NOT NULL,
    season INTEGER NOT NULL DEFAULT 0,
    episode INTEGER NOT NULL DEFAULT 0,
    title TEXT,
    poster TEXT,
    watched_at INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_history_user_time ON history(user_id, watched_at DESC);

  CREATE TABLE IF NOT EXISTS watchlist (
    user_id INTEGER NOT NULL,
    tmdb_id INTEGER NOT NULL,
    media_type TEXT NOT NULL,
    title TEXT,
    poster TEXT,
    status TEXT NOT NULL DEFAULT 'todo',
    added_at INTEGER DEFAULT (strftime('%s','now')),
    PRIMARY KEY (user_id, tmdb_id, media_type),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS _meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tmdb_cache (
    cache_key TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    fetched_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
`);

// Migration: rename legacy `username` column to `email` if needed
const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (userCols.includes('username') && !userCols.includes('email')) {
  db.exec("ALTER TABLE users RENAME COLUMN username TO email");
}
// Migration: add autoplay_next preference column for existing users
if (!userCols.includes('autoplay_next')) {
  db.exec("ALTER TABLE users ADD COLUMN autoplay_next INTEGER NOT NULL DEFAULT 1");
}

// Migration: add watchlist.status (todo/done) for existing rows
const watchlistCols = db.prepare("PRAGMA table_info(watchlist)").all().map(c => c.name);
if (!watchlistCols.includes('status')) {
  db.exec("ALTER TABLE watchlist ADD COLUMN status TEXT NOT NULL DEFAULT 'todo'");
}

// Migration: history dedup + unique index
// (1) replace NULL season/episode with 0 to make UNIQUE deterministic
db.exec("UPDATE history SET season = 0 WHERE season IS NULL");
db.exec("UPDATE history SET episode = 0 WHERE episode IS NULL");
// (2) collapse duplicates keeping the most recent row per (user, tmdb, type, season, episode)
db.exec(`
  DELETE FROM history WHERE id NOT IN (
    SELECT MAX(id) FROM history GROUP BY user_id, tmdb_id, media_type, season, episode
  )
`);
// (3) unique index (idempotent)
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_history_unique ON history(user_id, tmdb_id, media_type, season, episode)");

function getOrCreateJwtSecret() {
  const row = db.prepare("SELECT value FROM _meta WHERE key = 'jwt_secret'").get();
  if (row) return row.value;
  const secret = crypto.randomBytes(48).toString('hex');
  db.prepare("INSERT INTO _meta (key, value) VALUES ('jwt_secret', ?)").run(secret);
  return secret;
}

module.exports = db;
module.exports.getOrCreateJwtSecret = getOrCreateJwtSecret;
