import { Router } from 'express';
import { requireSuperAdmin } from '../middleware/auth';
import { getAuthLogCapacity, getAuthLogPath, listAuthLogs } from '../services/auth-logs';
import { getPlaybackLogCapacity, getPlaybackLogPath, listPlaybackLogs } from '../services/playback-logs';
import {
  getProviderResolveLogCapacity,
  getProviderResolveLogPath,
  listProviderResolveLogs
} from '../services/provider-resolve-logs';
import { getAdminQueueStatus } from '../services/queue-status';
import { runEgressCheck } from '../services/admin-egress-check';
import { getTransportLogCapacity, getTransportLogPath, listTransportLogs } from '../services/transport-logs';
import type { AdminQueueStatus } from '../../../shared/types';

const router = Router();

router.get('/admin/playback-logs', requireSuperAdmin, (_req, res) => {
  const logs = listPlaybackLogs();
  res.json({
    count: logs.length,
    capacity: getPlaybackLogCapacity(),
    path: getPlaybackLogPath(),
    logs
  });
});

router.get('/admin/auth-logs', requireSuperAdmin, (_req, res) => {
  const logs = listAuthLogs();
  res.json({
    count: logs.length,
    capacity: getAuthLogCapacity(),
    path: getAuthLogPath(),
    logs
  });
});

router.get('/admin/provider-resolve-logs', requireSuperAdmin, (_req, res) => {
  const logs = listProviderResolveLogs();
  res.json({
    count: logs.length,
    capacity: getProviderResolveLogCapacity(),
    path: getProviderResolveLogPath(),
    logs
  });
});

router.get('/admin/transport-logs', requireSuperAdmin, (_req, res) => {
  const logs = listTransportLogs();
  res.json({
    count: logs.length,
    capacity: getTransportLogCapacity(),
    path: getTransportLogPath(),
    logs
  });
});

router.get('/admin/queue-status', requireSuperAdmin, async (_req, res) => {
  try {
    const status = await getAdminQueueStatus() as AdminQueueStatus;
    res.json(status);
  } catch (error) {
    console.error('[admin/queue-status]', error);
    res.status(503).json({ error: 'queue_status_unavailable' });
  }
});

router.get('/admin/egress-check', requireSuperAdmin, async (_req, res) => {
  res.json(await runEgressCheck());
});

export default router;
