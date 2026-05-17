/* One-shot import: copy every row from the legacy SQLite file at
 * SQLITE_PATH into the Postgres pointed to by DATABASE_URL. The script
 * is idempotent (ON CONFLICT DO NOTHING) so it can be re-run safely if
 * it dies partway through.
 *
 * Usage:
 *   SQLITE_PATH=/path/to/vixstream.db \
 *   DATABASE_URL=postgres://user:pass@host:5432/db \
 *   node dist/server/src/scripts/migrate-sqlite-to-pg.js
 */

import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { Pool, type PoolClient } from 'pg';

const SQLITE_PATH = process.env.SQLITE_PATH || path.resolve(process.cwd(), 'data', 'vixstream.db');
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
if (!fs.existsSync(SQLITE_PATH)) {
  console.error(`SQLite file not found at ${SQLITE_PATH}`);
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

interface MigrationStep {
  name: string;
  selectSql: string;
  // returns the INSERT SQL given the column list and the row values placeholders
  insert: (client: PoolClient, row: Record<string, unknown>) => Promise<void>;
  // optional sequence name to re-sync after the import
  sequenceFrom?: { table: string; column: string };
}

function quote(col: string): string {
  return `"${col}"`;
}

function buildInsertSql(table: string, columns: string[], conflict: string): string {
  const cols = columns.map(quote).join(', ');
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  return `INSERT INTO ${table} (${cols}) VALUES (${placeholders}) ON CONFLICT ${conflict} DO NOTHING`;
}

async function migrateTable(
  sqliteDb: Database.Database,
  client: PoolClient,
  name: string,
  selectSql: string,
  insertSql: string,
  columns: string[]
): Promise<{ read: number; written: number }> {
  const rows = sqliteDb.prepare(selectSql).all() as Array<Record<string, unknown>>;
  let written = 0;
  for (const row of rows) {
    const values = columns.map((c) => normalize(row[c]));
    const res = await client.query(insertSql, values);
    written += res.rowCount ?? 0;
  }
  return { read: rows.length, written };
}

function normalize(v: unknown): unknown {
  // SQLite returns 0/1 for booleans — fine for Postgres INTEGER columns.
  // Convert undefined → null so pg doesn't choke.
  if (v === undefined) return null;
  return v;
}

async function resetSequence(client: PoolClient, table: string, column: string): Promise<void> {
  await client.query(
    `SELECT setval(pg_get_serial_sequence($1, $2),
       COALESCE((SELECT MAX(${quote(column)}) FROM ${table}), 1),
       (SELECT MAX(${quote(column)}) IS NOT NULL FROM ${table}))`,
    [table, column]
  );
}

function findSchemaFile(): string {
  const candidates = [
    path.join(__dirname, '..', 'db-schema.sql'),
    path.join(__dirname, '..', '..', 'src', 'db-schema.sql'),
    path.join(process.cwd(), 'server', 'src', 'db-schema.sql'),
    path.join(process.cwd(), 'dist', 'server', 'src', 'db-schema.sql')
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('db-schema.sql not found in: ' + candidates.join(', '));
}

async function main(): Promise<void> {
  console.log(`[migrate] reading from ${SQLITE_PATH}`);
  const sqliteDb = new Database(SQLITE_PATH, { readonly: true });

  const client = await pool.connect();
  try {
    const ddl = fs.readFileSync(findSchemaFile(), 'utf8');
    await client.query(ddl);
    console.log('[migrate] schema ensured');
    // Order matters: users before anything that FK to it.
    const steps: Array<{
      name: string;
      select: string;
      columns: string[];
      conflict: string;
      sequence?: { table: string; column: string };
    }> = [
      {
        name: 'users',
        select: 'SELECT id, email, password_hash, autoplay_next, folders_enabled, created_at FROM users',
        columns: ['id', 'email', 'password_hash', 'autoplay_next', 'folders_enabled', 'created_at'],
        conflict: '(id)',
        sequence: { table: 'users', column: 'id' }
      },
      {
        name: '_meta',
        select: 'SELECT key, value FROM _meta',
        columns: ['key', 'value'],
        conflict: '(key)'
      },
      {
        name: 'invite_tokens',
        select: 'SELECT token, label, created_at, used_at, used_by_user_id, revoked_at FROM invite_tokens',
        columns: ['token', 'label', 'created_at', 'used_at', 'used_by_user_id', 'revoked_at'],
        conflict: '(token)'
      },
      {
        name: 'progress',
        select: `SELECT user_id, tmdb_id, media_type, season, episode, position, duration,
                        synthetic, title, poster, backdrop, updated_at FROM progress`,
        columns: ['user_id', 'tmdb_id', 'media_type', 'season', 'episode', 'position', 'duration',
                  'synthetic', 'title', 'poster', 'backdrop', 'updated_at'],
        conflict: '(user_id, tmdb_id, media_type, season, episode)'
      },
      {
        name: 'hidden_continue',
        select: 'SELECT user_id, tmdb_id, media_type, hidden_at FROM hidden_continue',
        columns: ['user_id', 'tmdb_id', 'media_type', 'hidden_at'],
        conflict: '(user_id, tmdb_id, media_type)'
      },
      {
        name: 'history',
        select: 'SELECT id, user_id, tmdb_id, media_type, season, episode, title, poster, watched_at FROM history',
        columns: ['id', 'user_id', 'tmdb_id', 'media_type', 'season', 'episode', 'title', 'poster', 'watched_at'],
        conflict: '(user_id, tmdb_id, media_type, season, episode)',
        sequence: { table: 'history', column: 'id' }
      },
      {
        name: 'watchlist',
        select: `SELECT user_id, tmdb_id, media_type, title, poster, status,
                        folder_name, done_aired_episodes, added_at FROM watchlist`,
        columns: ['user_id', 'tmdb_id', 'media_type', 'title', 'poster', 'status',
                  'folder_name', 'done_aired_episodes', 'added_at'],
        conflict: '(user_id, tmdb_id, media_type)'
      },
      {
        name: 'share_links',
        select: 'SELECT id, token, user_id, label, status, view_count, created_at FROM share_links',
        columns: ['id', 'token', 'user_id', 'label', 'status', 'view_count', 'created_at'],
        conflict: '(id)',
        sequence: { table: 'share_links', column: 'id' }
      },
      {
        name: 'tmdb_cache',
        select: 'SELECT cache_key, data, fetched_at FROM tmdb_cache',
        columns: ['cache_key', 'data', 'fetched_at'],
        conflict: '(cache_key)'
      }
    ];

    await client.query('BEGIN');
    for (const step of steps) {
      // Skip if source table missing (e.g. legacy db without share_links).
      const exists = sqliteDb.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
      ).get(step.name);
      if (!exists) {
        console.log(`[migrate] ${step.name}: source table missing — skipping`);
        continue;
      }

      const insertSql = buildInsertSql(step.name, step.columns, step.conflict);
      const stats = await migrateTable(sqliteDb, client, step.name, step.select, insertSql, step.columns);
      console.log(`[migrate] ${step.name}: read ${stats.read}, inserted ${stats.written}`);

      if (step.sequence) {
        await resetSequence(client, step.sequence.table, step.sequence.column);
        console.log(`[migrate]   sequence resynced for ${step.sequence.table}.${step.sequence.column}`);
      }
    }
    await client.query('COMMIT');

    console.log('\n[migrate] verification (row counts):');
    for (const step of steps) {
      const exists = sqliteDb.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
      ).get(step.name);
      if (!exists) continue;
      const sqliteCount = (sqliteDb.prepare(`SELECT COUNT(*) AS c FROM ${step.name}`).get() as { c: number }).c;
      const pgRes = await client.query(`SELECT COUNT(*)::INTEGER AS c FROM ${step.name}`);
      const pgCount = pgRes.rows[0].c;
      const flag = sqliteCount === pgCount ? 'OK ' : 'DIFF';
      console.log(`  [${flag}] ${step.name}: sqlite=${sqliteCount} pg=${pgCount}`);
    }
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
    sqliteDb.close();
    await pool.end();
  }
}

main().then(() => {
  console.log('\n[migrate] done');
  process.exit(0);
}).catch((err) => {
  console.error('[migrate] fatal', err);
  process.exit(1);
});
