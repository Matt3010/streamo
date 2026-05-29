import type { NextFunction, Request, Response } from 'express';
import { getTrustedCachedEgressCheck, refreshEgressCheckInBackground } from '../services/admin-egress-check';

export function ipMaskLogMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/health') {
    next();
    return;
  }

  refreshEgressCheckInBackground();
  const startedAt = Date.now();

  res.on('finish', () => {
    const originIp = getOriginIp(req);
    const egress = getTrustedCachedEgressCheck();
    const egressIp = egress?.ip ?? '-';
    const masked = egress ? egress.through_cloudflare && !sameIp(originIp, egressIp) : null;

    console.log(
      `[ip-mask] method=${req.method} uri=${req.originalUrl || req.url} status=${res.statusCode} origin_ip=${originIp} egress_ip=${egressIp} through_cf=${formatFlag(egress?.through_cloudflare)} masked=${formatFlag(masked)} checked_at=${egress?.checked_at ?? '-'} duration_ms=${Date.now() - startedAt}`
    );
  });

  next();
}

function getOriginIp(req: Request): string {
  return firstHeaderValue(req.headers['cf-connecting-ip'])
    ?? firstForwardedIp(req.headers['x-forwarded-for'])
    ?? firstHeaderValue(req.headers['x-real-ip'])
    ?? normalizeIp(req.ip)
    ?? normalizeIp(req.socket.remoteAddress)
    ?? '-';
}

function firstForwardedIp(value: string | string[] | undefined): string | null {
  const header = firstHeaderValue(value);
  if (!header) {
    return null;
  }

  const first = header.split(',')[0]?.trim();
  return normalizeIp(first);
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return normalizeIp(value[0]);
  }
  return normalizeIp(value);
}

function normalizeIp(value: string | undefined | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sameIp(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function formatFlag(value: boolean | null | undefined): string {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return 'unknown';
}
