import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { SUPER_ADMIN_EMAIL } from './config';

const DB_DIR = process.env.DB_DIR || '/data';
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

export const db = new Database(path.join(DB_DIR, 'vixstream.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    autoplay_next INTEGER NOT NULL DEFAULT 1,
    folders_enabled INTEGER NOT NULL DEFAULT 1,
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
    synthetic INTEGER NOT NULL DEFAULT 0,
    title TEXT,
    poster TEXT,
    backdrop TEXT,
    updated_at INTEGER DEFAULT (strftime('%s','now')),
    PRIMARY KEY (user_id, tmdb_id, media_type, season, episode),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_progress_user_updated ON progress(user_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS hidden_continue (
    user_id INTEGER NOT NULL,
    tmdb_id INTEGER NOT NULL,
    media_type TEXT NOT NULL,
    hidden_at INTEGER DEFAULT (strftime('%s','now')),
    PRIMARY KEY (user_id, tmdb_id, media_type),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

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
    folder_name TEXT,
    done_aired_episodes INTEGER NOT NULL DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS invite_tokens (
    token TEXT PRIMARY KEY,
    label TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    used_at INTEGER,
    used_by_user_id INTEGER,
    revoked_at INTEGER,
    FOREIGN KEY (used_by_user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_invite_used_by ON invite_tokens(used_by_user_id);

  CREATE TABLE IF NOT EXISTS share_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    label TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    view_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_share_links_user ON share_links(user_id);
`);

// Migration: add view_count to share_links for pre-existing rows.
const shareLinksCols = (db.prepare("PRAGMA table_info(share_links)").all() as Array<{ name: string }>).map(c => c.name);
if (!shareLinksCols.includes('view_count')) {
  db.exec("ALTER TABLE share_links ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0");
}

// Migration: rename legacy `username` column to `email` if needed
const userCols = (db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).map(c => c.name);
if (userCols.includes('username') && !userCols.includes('email')) {
  db.exec("ALTER TABLE users RENAME COLUMN username TO email");
}
// Migration: add autoplay_next preference column for existing users
if (!userCols.includes('autoplay_next')) {
  db.exec("ALTER TABLE users ADD COLUMN autoplay_next INTEGER NOT NULL DEFAULT 1");
}
if (!userCols.includes('folders_enabled')) {
  db.exec("ALTER TABLE users ADD COLUMN folders_enabled INTEGER NOT NULL DEFAULT 1");
}

// Migration: add watchlist.status (todo/done) for existing rows
const watchlistCols = (db.prepare("PRAGMA table_info(watchlist)").all() as Array<{ name: string }>).map(c => c.name);
if (!watchlistCols.includes('status')) {
  db.exec("ALTER TABLE watchlist ADD COLUMN status TEXT NOT NULL DEFAULT 'todo'");
}
if (!watchlistCols.includes('folder_name')) {
  db.exec("ALTER TABLE watchlist ADD COLUMN folder_name TEXT");
}
if (!watchlistCols.includes('done_aired_episodes')) {
  db.exec("ALTER TABLE watchlist ADD COLUMN done_aired_episodes INTEGER NOT NULL DEFAULT 0");
}

// Migration: cleanup synthetic progress rows generated by an older
// "mark as done" implementation. Real playback progress now remains the
// only source of truth for resume / next episode.
const progressCols = (db.prepare("PRAGMA table_info(progress)").all() as Array<{ name: string }>).map(c => c.name);
if (!progressCols.includes('synthetic')) {
  db.exec("ALTER TABLE progress ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0");
}
db.exec(`
  UPDATE progress
  SET synthetic = 1
  WHERE synthetic = 0
    AND media_type = 'tv'
    AND position = 1
    AND duration = 1
    AND title IS NULL
    AND poster IS NULL
    AND backdrop IS NULL
`);
db.exec("DELETE FROM progress WHERE synthetic = 1");

// Migration: history dedup + unique index
db.exec("UPDATE history SET season = 0 WHERE season IS NULL");
db.exec("UPDATE history SET episode = 0 WHERE episode IS NULL");
db.exec(`
  DELETE FROM history WHERE id NOT IN (
    SELECT MAX(id) FROM history GROUP BY user_id, tmdb_id, media_type, season, episode
  )
`);
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_history_unique ON history(user_id, tmdb_id, media_type, season, episode)");

// Migration: create legacy invite_tokens for existing users (except super admin)
const inviteMigDone = db.prepare("SELECT value FROM _meta WHERE key = 'migration_invite_tokens_v1'").get() as { value: string } | undefined;
if (!inviteMigDone) {
  const existingUsers = db.prepare("SELECT id, email FROM users").all() as Array<{ id: number; email: string }>;
  const insertToken = db.prepare(
    "INSERT INTO invite_tokens (token, label, used_at, used_by_user_id) VALUES (?, 'legacy', strftime('%s','now'), ?)"
  );
  for (const u of existingUsers) {
    // Skip super admin — they don't need an invite token
    if (SUPER_ADMIN_EMAIL && u.email.toLowerCase() === SUPER_ADMIN_EMAIL) continue;
    const legacyToken = `legacy_${crypto.randomBytes(12).toString('base64url')}`;
    insertToken.run(legacyToken, u.id);
  }
  db.prepare("INSERT INTO _meta (key, value) VALUES ('migration_invite_tokens_v1', 'done')").run();
}

export function getOrCreateJwtSecret(): string {
  const row = db.prepare("SELECT value FROM _meta WHERE key = 'jwt_secret'").get() as { value: string } | undefined;
  if (row) return row.value;
  const secret = crypto.randomBytes(48).toString('hex');
  db.prepare("INSERT INTO _meta (key, value) VALUES ('jwt_secret', ?)").run(secret);
  return secret;
}
