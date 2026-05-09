import { db } from '../db';
import type { AdminSession } from '../../../shared/types';

export function listLiveAdminSessions(): AdminSession[] {
  return db.prepare(`
    SELECT p.user_id, u.email,
           p.tmdb_id, p.media_type, p.season, p.episode,
           p.position, p.duration, p.title, p.poster, p.updated_at
    FROM progress p
    JOIN users u ON u.id = p.user_id
    WHERE p.updated_at > strftime('%s','now') - 60
    ORDER BY p.updated_at DESC
  `).all() as AdminSession[];
}
