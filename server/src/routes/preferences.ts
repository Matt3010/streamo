import { Router } from 'express';
import { query } from '../db';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.put('/user/preferences', requireAuth, async (req, res) => {
  const { autoplay_next, folders_enabled } = req.body || {};
  const updates: string[] = [];
  const params: number[] = [];
  let idx = 1;

  if (autoplay_next !== undefined) {
    if (autoplay_next !== 0 && autoplay_next !== 1) return res.status(400).json({ error: 'invalid_value' });
    updates.push(`autoplay_next = $${idx++}`);
    params.push(autoplay_next);
  }

  if (folders_enabled !== undefined) {
    if (folders_enabled !== 0 && folders_enabled !== 1) return res.status(400).json({ error: 'invalid_value' });
    updates.push(`folders_enabled = $${idx++}`);
    params.push(folders_enabled);
  }

  if (updates.length === 0) return res.status(400).json({ error: 'missing_fields' });

  params.push(req.user!.id);
  await query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`, params);
  res.json({
    ok: true,
    ...(autoplay_next !== undefined ? { autoplay_next } : {}),
    ...(folders_enabled !== undefined ? { folders_enabled } : {})
  });
});

export default router;
