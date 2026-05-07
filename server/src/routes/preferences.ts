import { Router } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.put('/user/preferences', requireAuth, (req, res) => {
  const { autoplay_next } = req.body || {};
  if (autoplay_next !== 0 && autoplay_next !== 1) return res.status(400).json({ error: 'invalid_value' });
  db.prepare('UPDATE users SET autoplay_next = ? WHERE id = ?').run(autoplay_next, req.user!.id);
  res.json({ ok: true, autoplay_next });
});

export default router;
