import { Router } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.put('/user/preferences', requireAuth, (req, res) => {
  const { autoplay_next, folders_enabled } = req.body || {};
  const updates: string[] = [];
  const params: number[] = [];

  if (autoplay_next !== undefined) {
    if (autoplay_next !== 0 && autoplay_next !== 1) return res.status(400).json({ error: 'invalid_value' });
    updates.push('autoplay_next = ?');
    params.push(autoplay_next);
  }

  if (folders_enabled !== undefined) {
    if (folders_enabled !== 0 && folders_enabled !== 1) return res.status(400).json({ error: 'invalid_value' });
    updates.push('folders_enabled = ?');
    params.push(folders_enabled);
  }

  if (updates.length === 0) return res.status(400).json({ error: 'missing_fields' });

  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params, req.user!.id);
  res.json({
    ok: true,
    ...(autoplay_next !== undefined ? { autoplay_next } : {}),
    ...(folders_enabled !== undefined ? { folders_enabled } : {})
  });
});

export default router;
