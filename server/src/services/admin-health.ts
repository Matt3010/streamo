import { hasRedisConfig, withRedisClient } from './redis';
import { getWatchlistQueue, WATCHLIST_QUEUE_NAME } from './watchlist-jobs';
import { getNotificationsDeliveryQueue, NOTIFICATIONS_DELIVERY_QUEUE_NAME } from './notifications-jobs';
import { listWorkerHeartbeats } from './worker-heartbeat';
import { runEgressCheck } from './admin-egress-check';
import { createAdminAlert } from './notifications';
import type { AdminAlertKind } from '../../../shared/types';

// All thresholds intentionally lenient — admin alerts should fire only when
// something is genuinely wrong, not on harmless transients. Tune up if you
// see false positives in the inbox.
const WORKER_HEARTBEAT_STALE_SECONDS = 90;
const FAILED_JOBS_THRESHOLD = 1; // any failed job in either queue alerts
const PROVIDER_OUTAGE_EVENTS_THRESHOLD = 5; // 5+ events in 5 min
const PROVIDER_OUTAGE_WINDOW_SECONDS = 5 * 60;

const PROVIDER_OUTAGE_REDIS_KEY = 'streamo:provider:outage-events';
const HEALTH_STATE_REDIS_KEY = 'streamo:admin-health:state';
const EGRESS_OK_REDIS_KEY = 'streamo:admin-health:egress-ok';
// Cache TTL slightly above the 5-minute scan cadence so a missed scan
// (worker restart, transient) doesn't immediately erase the previous
// observation. The pill falls back to `true` only when truly no scan
// has ever populated the cache.
const EGRESS_CACHE_TTL_SECONDS = 8 * 60;

type HealthKey = AdminAlertKind;

// Probe each signal, compare with the previous boolean stored in Redis,
// and fire createAdminAlert on a clean OK→BAD transition. Stays silent
// while the condition persists (the previous state stays "bad") to avoid
// spamming during a sustained outage.
export async function runAdminHealthChecks(): Promise<void> {
  if (!hasRedisConfig()) return;

  const checks = await Promise.all([
    checkWorker(),
    checkFailedJobs(),
    checkEgress(),
    checkProvider()
  ]);

  await reconcileTransitions(checks);
}

interface HealthProbe {
  kind: HealthKey;
  ok: boolean;
  title: string;
  detail: string;
}

async function checkWorker(): Promise<HealthProbe> {
  return withRedisClient(async (redis) => {
    const beats = await listWorkerHeartbeats(redis);
    const now = Math.floor(Date.now() / 1000);
    const alive = beats.filter((b) => now - b.last_seen_at <= WORKER_HEARTBEAT_STALE_SECONDS);
    if (alive.length === 0) {
      return {
        kind: 'worker',
        ok: false,
        title: 'Nessun worker attivo',
        detail: beats.length === 0
          ? 'Nessun heartbeat registrato'
          : `${beats.length} worker registrato/i, tutti stale (>${WORKER_HEARTBEAT_STALE_SECONDS}s)`
      };
    }
    return { kind: 'worker', ok: true, title: '', detail: `${alive.length} worker online` };
  });
}

async function checkFailedJobs(): Promise<HealthProbe> {
  const queues = [
    { name: WATCHLIST_QUEUE_NAME, queue: getWatchlistQueue() },
    { name: NOTIFICATIONS_DELIVERY_QUEUE_NAME, queue: getNotificationsDeliveryQueue() }
  ];
  const counts = await Promise.all(queues.map(async (q) => {
    if (!q.queue) return { name: q.name, failed: 0 };
    const c = await q.queue.getJobCounts('failed');
    return { name: q.name, failed: c.failed ?? 0 };
  }));
  const offenders = counts.filter((c) => c.failed >= FAILED_JOBS_THRESHOLD);
  if (offenders.length === 0) {
    return { kind: 'failed_jobs', ok: true, title: '', detail: 'nessun job fallito' };
  }
  return {
    kind: 'failed_jobs',
    ok: false,
    title: 'Job falliti in coda',
    detail: offenders.map((o) => `${o.name}: ${o.failed}`).join(', ')
  };
}

async function checkEgress(): Promise<HealthProbe> {
  // Single source of truth for the egress probe — same service the
  // /admin/egress-check route uses on manual refresh.
  //
  // Health is determined by the Cloudflare trace alone: warp=on means
  // outbound traffic is going through the WARP tunnel, which is what
  // we actually care about. ipinfo.io contributes only ASN/city metadata
  // and is third-party-flaky — its 5xx responses (non-JSON "upstream
  // connect" bodies, etc.) used to false-alarm this check.
  const result = await runEgressCheck();
  const traceFailed = result.errors.some((e) => e.startsWith('trace:'));
  const ok = result.warp && !traceFailed;

  // Cache the latest observation so the admin Queue pill can read it
  // without rerunning the full probe on every page hit. TTL is slightly
  // wider than the 5-min scan so a delayed scan doesn't blank the pill.
  if (hasRedisConfig()) {
    await withRedisClient((redis) =>
      redis.set(EGRESS_OK_REDIS_KEY, ok ? '1' : '0', 'EX', EGRESS_CACHE_TTL_SECONDS)
    );
  }

  if (!ok) {
    const traceErrors = result.errors.filter((e) => e.startsWith('trace:'));
    const detail = !result.warp
      ? 'warp=off'
      : (traceErrors.join('; ') || 'trace probe failed');
    return { kind: 'egress', ok: false, title: 'Egress non via WARP', detail };
  }
  return { kind: 'egress', ok: true, title: '', detail: `warp=on colo=${result.colo ?? '?'}` };
}

// Pill reader. Returns true when no observation has been cached yet —
// the page renders "ok" instead of "bad" before the first scan lands,
// which is the right default (we don't want a false-alarm pill on
// fresh boot).
export async function readEgressOk(): Promise<boolean> {
  if (!hasRedisConfig()) return true;
  return withRedisClient(async (redis) => {
    const v = await redis.get(EGRESS_OK_REDIS_KEY);
    return v === null ? true : v === '1';
  });
}

async function checkProvider(): Promise<HealthProbe> {
  const count = await readProviderOutageCount();
  if (count >= PROVIDER_OUTAGE_EVENTS_THRESHOLD) {
    return {
      kind: 'provider',
      ok: false,
      title: 'Provider non disponibile',
      detail: `${count} fail negli ultimi ${PROVIDER_OUTAGE_WINDOW_SECONDS / 60} min`
    };
  }
  return { kind: 'provider', ok: true, title: '', detail: `${count} fail recenti` };
}

// Producer side: the provider resolver calls this every time it returns
// 'temporarily_unavailable'. ZSET with timestamp as score lets the
// consumer (this module + queue-status) compute a sliding-window count
// cheaply with ZREMRANGEBYSCORE + ZCARD.
export async function recordProviderOutageEvent(): Promise<void> {
  if (!hasRedisConfig()) return;
  try {
    await withRedisClient(async (redis) => {
      const now = Math.floor(Date.now() / 1000);
      await redis.zadd(PROVIDER_OUTAGE_REDIS_KEY, now, `${now}-${Math.random()}`);
      await redis.zremrangebyscore(PROVIDER_OUTAGE_REDIS_KEY, 0, now - PROVIDER_OUTAGE_WINDOW_SECONDS);
      // Bounded TTL so a one-off spike eventually clears even without future calls.
      await redis.expire(PROVIDER_OUTAGE_REDIS_KEY, PROVIDER_OUTAGE_WINDOW_SECONDS * 2);
    });
  } catch (error) {
    console.error('[admin-health] failed to record provider outage event', error);
  }
}

// Reader used by both checkProvider (transition logic) and queue-status
// (pill on the admin UI).
export async function readProviderOutageCount(): Promise<number> {
  if (!hasRedisConfig()) return 0;
  try {
    return await withRedisClient(async (redis) => {
      const now = Math.floor(Date.now() / 1000);
      await redis.zremrangebyscore(PROVIDER_OUTAGE_REDIS_KEY, 0, now - PROVIDER_OUTAGE_WINDOW_SECONDS);
      return redis.zcard(PROVIDER_OUTAGE_REDIS_KEY);
    });
  } catch {
    return 0;
  }
}

export async function isProviderOutage(): Promise<boolean> {
  return (await readProviderOutageCount()) >= PROVIDER_OUTAGE_EVENTS_THRESHOLD;
}

async function reconcileTransitions(probes: HealthProbe[]): Promise<void> {
  await withRedisClient(async (redis) => {
    const previous = await redis.hgetall(HEALTH_STATE_REDIS_KEY);
    const nextState: Record<string, string> = {};

    for (const probe of probes) {
      const prevVal = previous[probe.kind];
      const prevOk = prevVal === undefined ? null : prevVal === 'ok';
      nextState[probe.kind] = probe.ok ? 'ok' : 'bad';

      // Only fire on a clean OK→BAD transition. First-run (prevOk === null)
      // intentionally does NOT fire — keeps the alert from going off the
      // first time the worker boots into an already-broken state without
      // any prior observation.
      if (prevOk === true && !probe.ok) {
        void createAdminAlert(probe.kind, probe.title, probe.detail).catch((err) => {
          console.error(`[admin-health] alert dispatch failed kind=${probe.kind}`, err);
        });
      }
    }

    await redis.hset(HEALTH_STATE_REDIS_KEY, nextState);
  });
}
