import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { toInt } from '../utils/validation';
import {
  deleteNotification,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead
} from '../services/notifications';

const router = Router();

router.get('/user/notifications', requireAuth, async (req, res) => {
  const requested = toInt(req.query.limit ?? 50, { min: 1, max: 100 }) ?? 50;
  const data = await listNotificationsForUser(req.user!.id, requested);
  res.json(data);
});

router.post('/user/notifications/:id/read', requireAuth, async (req, res) => {
  const id = toInt(req.params.id, { min: 1 });
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const ok = await markNotificationRead(req.user!.id, id);
  if (!ok) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

router.post('/user/notifications/read-all', requireAuth, async (req, res) => {
  const updated = await markAllNotificationsRead(req.user!.id);
  res.json({ ok: true, updated });
});

router.delete('/user/notifications/:id', requireAuth, async (req, res) => {
  const id = toInt(req.params.id, { min: 1 });
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  const ok = await deleteNotification(req.user!.id, id);
  if (!ok) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

export default router;
