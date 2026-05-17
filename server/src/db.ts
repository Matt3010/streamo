import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { SUPER_ADMIN_EMAIL } from './config';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required (postgres connection string)');
}

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX ?? 10)
});

pool.on('error', (err) => {
  console.error('[pg pool] idle client error', err);
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: ReadonlyArray<unknown> = []
): Promise<{ rows: T[]; rowCount: number }> {
  const res = await pool.query<T>(text, params as unknown as unknown[]);
  return { rows: res.rows, rowCount: res.rowCount ?? 0 };
}

export async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

// Convenience for query() inside a transaction client.
export async function clientQuery<T extends QueryResultRow = QueryResultRow>(
  client: PoolClient,
  text: string,
  params: ReadonlyArray<unknown> = []
): Promise<{ rows: T[]; rowCount: number }> {
  const res = await client.query<T>(text, params as unknown as unknown[]);
  return { rows: res.rows, rowCount: res.rowCount ?? 0 };
}

function findSchemaFile(): string {
  // Try src layout (ts-node / dev) then dist layout (compiled).
  const candidates = [
    path.join(__dirname, 'db-schema.sql'),
    path.join(__dirname, '..', 'src', 'db-schema.sql'),
    path.join(process.cwd(), 'server', 'src', 'db-schema.sql')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('db-schema.sql not found in any of: ' + candidates.join(', '));
}

let initPromise: Promise<void> | null = null;
let cachedJwtSecret: string | null = null;

export function initDb(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const schemaPath = findSchemaFile();
    const ddl = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(ddl);
    await runLegacyInviteMigration();
    cachedJwtSecret = process.env.JWT_SECRET || await loadOrCreateJwtSecret();
  })();
  return initPromise;
}

export function getJwtSecret(): string {
  if (!cachedJwtSecret) {
    throw new Error('JWT secret not initialized — call initDb() before using auth');
  }
  return cachedJwtSecret;
}

async function runLegacyInviteMigration(): Promise<void> {
  const done = await query<{ value: string }>(
    "SELECT value FROM _meta WHERE key = 'migration_invite_tokens_v1'"
  );
  if (done.rowCount > 0) return;

  const users = await query<{ id: number; email: string }>('SELECT id, email FROM users');
  for (const u of users.rows) {
    if (SUPER_ADMIN_EMAIL && u.email.toLowerCase() === SUPER_ADMIN_EMAIL) continue;
    const legacyToken = `legacy_${crypto.randomBytes(12).toString('base64url')}`;
    await query(
      "INSERT INTO invite_tokens (token, label, used_at, used_by_user_id) " +
      "VALUES ($1, 'legacy', EXTRACT(EPOCH FROM NOW())::BIGINT, $2)",
      [legacyToken, u.id]
    );
  }
  await query(
    "INSERT INTO _meta (key, value) VALUES ('migration_invite_tokens_v1', 'done') " +
    "ON CONFLICT (key) DO NOTHING"
  );
}

async function loadOrCreateJwtSecret(): Promise<string> {
  const row = await query<{ value: string }>(
    "SELECT value FROM _meta WHERE key = 'jwt_secret'"
  );
  if (row.rowCount > 0) return row.rows[0].value;
  const secret = crypto.randomBytes(48).toString('hex');
  await query(
    "INSERT INTO _meta (key, value) VALUES ('jwt_secret', $1) ON CONFLICT (key) DO NOTHING",
    [secret]
  );
  const verify = await query<{ value: string }>("SELECT value FROM _meta WHERE key = 'jwt_secret'");
  return verify.rows[0].value;
}
