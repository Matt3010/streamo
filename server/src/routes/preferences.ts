import { Router } from 'express';
import { kdb } from '../db';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.put('/user/preferences', requireAuth, async (req, res) => {
  const { autoplay_next, folders_enabled } = req.body || {};
  const updates: { autoplay_next?: 0 | 1; folders_enabled?: 0 | 1 } = {};

  if (autoplay_next !== undefined) {
    if (autoplay_next !== 0 && autoplay_next !== 1) return res.status(400).json({ error: 'invalid_value' });
    updates.autoplay_next = autoplay_next;
  }

  if (folders_enabled !== undefined) {
    if (folders_enabled !== 0 && folders_enabled !== 1) return res.status(400).json({ error: 'invalid_value' });
    updates.folders_enabled = folders_enabled;
  }

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'missing_fields' });

  await kdb.updateTable('users').set(updates).where('id', '=', req.user!.id).execute();
  res.json({
    ok: true,
    ...(autoplay_next !== undefined ? { autoplay_next } : {}),
    ...(folders_enabled !== undefined ? { folders_enabled } : {})
  });
});

export default router;
