import { Pool, types as pgTypes } from 'pg';
import { Kysely, PostgresDialect, Transaction, sql } from 'kysely';
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { SUPER_ADMIN_EMAIL } from './config';
import type { Database } from './db-types';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required (postgres connection string)');
}

// node-pg returns BIGINT as string by default to avoid precision loss
// for values > 2^53. Our schema only stores Unix-epoch seconds (well
// within safe-int range) and INTEGER counts, so parse them as JS
// numbers — keeps the existing app code unchanged.
pgTypes.setTypeParser(20, (val) => (val === null ? null : Number(val)));

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX ?? 10)
});

pool.on('error', (err) => {
  console.error('[pg pool] idle client error', err);
});

export const kdb = new Kysely<Database>({
  dialect: new PostgresDialect({ pool })
});

export type Tx = Transaction<Database>;

export async function withTx<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  return kdb.transaction().execute(fn);
}

function findMigrationsFolder(): string {
  const candidates = [
    path.join(__dirname, 'migrations'),
    path.join(__dirname, '..', 'src', 'migrations'),
    path.join(process.cwd(), 'server', 'src', 'migrations')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('migrations folder not found in: ' + candidates.join(', '));
}

async function runMigrations(): Promise<void> {
  const migrator = new Migrator({
    db: kdb,
    provider: new FileMigrationProvider({
      fs: fs.promises,
      path,
      migrationFolder: findMigrationsFolder()
    })
  });
  const { results, error } = await migrator.migrateToLatest();
  for (const r of results ?? []) {
    if (r.status === 'Success') console.log(`[migrate] applied ${r.migrationName}`);
    else if (r.status === 'Error') console.error(`[migrate] FAILED ${r.migrationName}`);
  }
  if (error) throw error;
}

let initPromise: Promise<void> | null = null;
let cachedJwtSecret: string | null = null;

export function initDb(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const autoMigrate = ['1', 'true', 'yes'].includes((process.env.AUTO_MIGRATE ?? '').toLowerCase());
    if (autoMigrate) {
      console.log('[migrate] AUTO_MIGRATE enabled — running migrations to latest');
      await runMigrations();
    } else {
      console.log('[migrate] AUTO_MIGRATE not set — skipping. Run `npm run migrate:up` manually.');
    }
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
  const done = await kdb
    .selectFrom('_meta')
    .select('value')
    .where('key', '=', 'migration_invite_tokens_v1')
    .executeTakeFirst();
  if (done) return;

  const users = await kdb.selectFrom('users').select(['id', 'email']).execute();
  for (const u of users) {
    if (SUPER_ADMIN_EMAIL && u.email.toLowerCase() === SUPER_ADMIN_EMAIL) continue;
    const legacyToken = `legacy_${crypto.randomBytes(12).toString('base64url')}`;
    await kdb
      .insertInto('invite_tokens')
      .values({
        token: legacyToken,
        label: 'legacy',
        used_at: sql<number>`EXTRACT(EPOCH FROM NOW())::BIGINT`,
        used_by_user_id: u.id
      })
      .execute();
  }
  await kdb
    .insertInto('_meta')
    .values({ key: 'migration_invite_tokens_v1', value: 'done' })
    .onConflict((oc) => oc.column('key').doNothing())
    .execute();
}

async function loadOrCreateJwtSecret(): Promise<string> {
  const row = await kdb
    .selectFrom('_meta')
    .select('value')
    .where('key', '=', 'jwt_secret')
    .executeTakeFirst();
  if (row) return row.value;

  const secret = crypto.randomBytes(48).toString('hex');
  await kdb
    .insertInto('_meta')
    .values({ key: 'jwt_secret', value: secret })
    .onConflict((oc) => oc.column('key').doNothing())
    .execute();
  const verify = await kdb
    .selectFrom('_meta')
    .select('value')
    .where('key', '=', 'jwt_secret')
    .executeTakeFirstOrThrow();
  return verify.value;
}
