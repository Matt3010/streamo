import { query } from '../db';
import type { AdminSession } from '../../../shared/types';

export const LIVE_SESSION_WINDOW_SECONDS = 60;

export async function listLiveAdminSessions(): Promise<AdminSession[]> {
  const res = await query<AdminSession>(`
    SELECT p.user_id, u.email,
           p.tmdb_id, p.media_type, p.season, p.episode,
           p.position, p.duration, p.title, p.poster, p.updated_at
    FROM progress p
    JOIN users u ON u.id = p.user_id
    WHERE p.updated_at > EXTRACT(EPOCH FROM NOW())::BIGINT - $1
    ORDER BY p.updated_at DESC
  `, [LIVE_SESSION_WINDOW_SECONDS]);
  return res.rows;
}
