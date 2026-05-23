import { Router } from 'express';
import { kdb } from '../db';
import { requireAuth } from '../middleware/auth';

const router = Router();

type Bool01 = 0 | 1;
const BACKGROUND_PATTERN_PREFIX = 'data:image/png;base64,';
// Keep comfortably below the global express.json({ limit: '100kb' }) cap so
// valid pattern saves don't get rejected earlier by the body parser with 413.
const BACKGROUND_PATTERN_MAX_LENGTH = 95_000;

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

function isBackgroundPattern(value: unknown): value is string | null {
  return value === null || (
    typeof value === 'string'
    && value.startsWith(BACKGROUND_PATTERN_PREFIX)
    && value.length <= BACKGROUND_PATTERN_MAX_LENGTH
  );
}

router.put('/user/preferences', requireAuth, async (req, res) => {
  const body = req.body || {};
  const updates: Partial<Record<PrefField, Bool01> & { background_pattern_data_url: string | null }> = {};

  for (const field of BOOL_FIELDS) {
    const value = body[field];
    if (value === undefined) continue;
    if (!isBool01(value)) return res.status(400).json({ error: 'invalid_value', field });
    updates[field] = value;
  }

  if (body.background_pattern_data_url !== undefined) {
    if (!isBackgroundPattern(body.background_pattern_data_url)) {
      return res.status(400).json({ error: 'invalid_value', field: 'background_pattern_data_url' });
    }
    updates.background_pattern_data_url = body.background_pattern_data_url;
  }

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'missing_fields' });

  await kdb.updateTable('users').set(updates).where('id', '=', req.user!.id).execute();
  res.json({ ok: true, ...updates });
});

export default router;
