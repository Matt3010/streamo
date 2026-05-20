import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE provider_title_map
    ADD COLUMN IF NOT EXISTS candidates_json TEXT
  `.execute(db);

  // pending_review titles were auto-resolved against a weak match and
  // retried every 24h. With the manual-approval flow they should instead
  // be re-resolved at the next access so candidates are populated and the
  // user can pick from the picker UI.
  await sql`
    UPDATE provider_title_map
    SET match_status = 'failed', last_checked_at = 0
    WHERE match_status = 'pending_review'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE provider_title_map DROP COLUMN IF EXISTS candidates_json
  `.execute(db);
}
