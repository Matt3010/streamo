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
import { getTransportLogCapacity, getTransportLogPath, listTransportLogs } from '../services/transport-logs';
import type { AdminEgressCheck, AdminQueueStatus } from '../../../shared/types';
import { fetchWithTimeout } from '../utils/fetch';

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
  const errors: string[] = [];

  // Cloudflare's own trace endpoint is authoritative for "are you WARP-on right
  // now?" — it returns plain text like `warp=on\ncolo=MXP\nip=...`.
  let trace: Record<string, string> = {};
  try {
    const r = await fetchWithTimeout('https://www.cloudflare.com/cdn-cgi/trace', {}, 5000);
    const text = await r.text();
    trace = Object.fromEntries(
      text.split('\n').flatMap((line) => {
        const eq = line.indexOf('=');
        return eq > 0 ? [[line.slice(0, eq), line.slice(eq + 1)]] : [];
      })
    );
  } catch (e) {
    errors.push(`trace: ${e instanceof Error ? e.message : 'fetch_failed'}`);
  }

  // ipinfo.io adds the ASN/org so we can sanity-check it's really Cloudflare's
  // AS13335 and not some other tunnel.
  let info: { ip?: string; org?: string; country?: string; city?: string } = {};
  try {
    const r = await fetchWithTimeout('https://ipinfo.io/json', {}, 5000);
    info = (await r.json()) as typeof info;
  } catch (e) {
    errors.push(`ipinfo: ${e instanceof Error ? e.message : 'fetch_failed'}`);
  }

  const warp = trace.warp === 'on';
  const org = info.org ?? null;
  const isCloudflare = !!org && /cloudflare/i.test(org);

  const payload: AdminEgressCheck = {
    checked_at: Math.floor(Date.now() / 1000),
    ip: trace.ip ?? info.ip ?? null,
    asn_org: org,
    warp,
    colo: trace.colo ?? null,
    country: trace.loc ?? info.country ?? null,
    city: info.city ?? null,
    through_cloudflare: warp && isCloudflare,
    errors
  };
  res.json(payload);
});

export default router;
