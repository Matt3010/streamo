/* CLI for Kysely migrations.
 *
 * Usage:
 *   node dist/server/src/scripts/migrate.js up         # apply all pending
 *   node dist/server/src/scripts/migrate.js down       # rollback the last one
 *   node dist/server/src/scripts/migrate.js status     # list applied vs pending
 *   node dist/server/src/scripts/migrate.js to <name>  # go to a specific migration
 *
 * DATABASE_URL must be set in env.
 */

import fs from 'fs';
import path from 'path';
import { FileMigrationProvider, Migrator, NO_MIGRATIONS } from 'kysely/migration';
import { kdb, pool } from '../db';

function findMigrationsFolder(): string {
  // src/scripts/migrate.ts -> compiled as dist/.../scripts/migrate.js.
  // Migrations sit next to scripts/ in the source tree, so adjust the
  // search to climb one level.
  const candidates = [
    path.join(__dirname, '..', 'migrations'),
    path.join(process.cwd(), 'dist', 'server', 'src', 'migrations'),
    path.join(process.cwd(), 'server', 'src', 'migrations')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('migrations folder not found in: ' + candidates.join(', '));
}

function makeMigrator(): Migrator {
  return new Migrator({
    db: kdb,
    provider: new FileMigrationProvider({
      fs: fs.promises,
      path,
      migrationFolder: findMigrationsFolder()
    })
  });
}

async function status(): Promise<void> {
  const migrator = makeMigrator();
  const all = await migrator.getMigrations();
  if (all.length === 0) {
    console.log('(no migrations found)');
    return;
  }
  console.log('name                                                   state');
  console.log('-----------------------------------------------------  ----------');
  for (const m of all) {
    const applied = m.executedAt ? `applied ${m.executedAt.toISOString()}` : 'pending';
    console.log(`${m.name.padEnd(55)}  ${applied}`);
  }
}

async function up(): Promise<void> {
  const migrator = makeMigrator();
  const { results, error } = await migrator.migrateToLatest();
  for (const r of results ?? []) {
    if (r.status === 'Success') console.log(`[up] ${r.migrationName}`);
    else if (r.status === 'Error') console.error(`[FAIL] ${r.migrationName}`);
    else console.log(`[skipped] ${r.migrationName}`);
  }
  if (error) {
    console.error('[migrate] error:', error);
    process.exit(1);
  }
}

async function down(): Promise<void> {
  const migrator = makeMigrator();
  const { results, error } = await migrator.migrateDown();
  for (const r of results ?? []) {
    if (r.status === 'Success') console.log(`[down] ${r.migrationName}`);
    else if (r.status === 'Error') console.error(`[FAIL] ${r.migrationName}`);
  }
  if (error) {
    console.error('[migrate] error:', error);
    process.exit(1);
  }
}

async function migrateTo(target: string): Promise<void> {
  const migrator = makeMigrator();
  const dest = target === 'zero' ? NO_MIGRATIONS : target;
  const { results, error } = await migrator.migrateTo(dest);
  for (const r of results ?? []) {
    console.log(`[${r.status.toLowerCase()}] ${r.direction.toLowerCase()} ${r.migrationName}`);
  }
  if (error) {
    console.error('[migrate] error:', error);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'up':
    case 'latest':
      await up();
      break;
    case 'down':
      await down();
      break;
    case 'status':
      await status();
      break;
    case 'to': {
      const target = process.argv[3];
      if (!target) {
        console.error('usage: migrate to <migration-name | zero>');
        process.exit(2);
      }
      await migrateTo(target);
      break;
    }
    default:
      console.error('usage: migrate (up|down|status|to <name>)');
      process.exit(2);
  }
}

main().then(() => pool.end()).catch((err) => {
  console.error('[migrate] fatal', err);
  pool.end().finally(() => process.exit(1));
});
