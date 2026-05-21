import { Kysely, sql } from 'kysely';

/* The invite-token / multi-user-registration feature was removed.
 * Users are now provisioned via the `users add` CLI script. Drop the
 * table and its supporting objects. IF EXISTS so the migration is safe
 * on deployments that already dropped the table by hand. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_invite_used_by`.execute(db);
  await sql`DROP TABLE IF EXISTS invite_tokens`.execute(db);
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  throw new Error('refusing to recreate invite_tokens — the feature was removed');
}
