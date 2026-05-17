import { kdb } from '../db';
import { sql } from 'kysely';
import type { AdminSession } from '../../../shared/types';

export const LIVE_SESSION_WINDOW_SECONDS = 60;

export async function listLiveAdminSessions(): Promise<AdminSession[]> {
  return kdb
    .selectFrom('progress as p')
    .innerJoin('users as u', 'u.id', 'p.user_id')
    .select([
      'p.user_id', 'u.email',
      'p.tmdb_id', 'p.media_type', 'p.season', 'p.episode',
      'p.position', 'p.duration', 'p.title', 'p.poster', 'p.updated_at'
    ])
    .where('p.updated_at', '>', sql<number>`EXTRACT(EPOCH FROM NOW())::BIGINT - ${LIVE_SESSION_WINDOW_SECONDS}`)
    .orderBy('p.updated_at', 'desc')
    .execute() as Promise<AdminSession[]>;
}
