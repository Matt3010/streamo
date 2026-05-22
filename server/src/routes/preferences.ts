import { Router } from 'express';
import { kdb } from '../db';
import { requireAuth } from '../middleware/auth';

const router = Router();

type Bool01 = 0 | 1;

const BOOL_FIELDS = [
  'autoplay_next',
  'folders_enabled',
  'notif_new_episode',
  'notif_new_season',
  'notif_resume_reminder'
] as const;

type PrefField = (typeof BOOL_FIELDS)[number];

function isBool01(value: unknown): value is Bool01 {
  return value === 0 || value === 1;
}

router.put('/user/preferences', requireAuth, async (req, res) => {
  const body = req.body || {};
  const updates: Partial<Record<PrefField, Bool01>> = {};

  for (const field of BOOL_FIELDS) {
    const value = body[field];
    if (value === undefined) continue;
    if (!isBool01(value)) return res.status(400).json({ error: 'invalid_value', field });
    updates[field] = value;
  }

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'missing_fields' });

  await kdb.updateTable('users').set(updates).where('id', '=', req.user!.id).execute();
  res.json({ ok: true, ...updates });
});

export default router;
