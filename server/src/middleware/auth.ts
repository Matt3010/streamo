import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../db';
import { COOKIE_SECURE, TOKEN_TTL, SUPER_ADMIN_EMAIL } from '../config';
import { authLogger } from '../services/auth-logs';

export interface AuthedUser {
  id: number;
  email: string;
}

export type AuthFailureReason = 'missing_token' | 'invalid_token';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

export async function authenticateToken(token?: string): Promise<{ user: AuthedUser | null; error?: AuthFailureReason }> {
  if (!token) {
    return { user: null, error: 'missing_token' };
  }

  try {
    const user = jwt.verify(token, getJwtSecret()) as AuthedUser;
    return { user };
  } catch {
    return { user: null, error: 'invalid_token' };
  }
}

export function isSuperAdminUser(user?: Pick<AuthedUser, 'email'> | null): boolean {
  return !!SUPER_ADMIN_EMAIL && !!user?.email && user.email.toLowerCase() === SUPER_ADMIN_EMAIL;
}

export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;

  const prefix = `${name}=`;
  for (const rawPart of cookieHeader.split(';')) {
    const part = rawPart.trim();
    if (!part.startsWith(prefix)) continue;
    const value = part.slice(prefix.length);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return undefined;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const result = await authenticateToken(req.cookies?.token);
  if (!result.user) {
    respondAuthFailure(req, res, result.error ?? 'unauthenticated');
    return;
  }

  req.user = result.user;
  next();
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  void requireAuth(req, res, () => {
    if (!isSuperAdminUser(req.user)) {
      respondForbidden(req, res, 'super_admin_required');
      return;
    }
    next();
  });
}

export function setAuthCookie(res: Response, user: AuthedUser): void {
  const token = jwt.sign({ id: user.id, email: user.email }, getJwtSecret(), {
    expiresIn: TOKEN_TTL
  });

  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: TOKEN_TTL * 1000,
    path: '/'
  });
}

export function respondAuthFailure(req: Request, res: Response, reason: string, event = 'request auth denied'): void {
  // Clear the cookie when the token itself is bad (expired/malformed/
  // unknown signature) — otherwise the browser keeps sending the dead
  // token until maxAge (30 days), spamming 401s. `missing_token` doesn't
  // need clearing because there was no cookie to begin with.
  if (reason === 'invalid_token') {
    res.clearCookie('token', { path: '/' });
  }

  authLogger.warn(event, buildAuthContext(req, reason));
  res.status(401).json({ error: reason });
}

export function respondForbidden(req: Request, res: Response, reason = 'forbidden', event = 'request forbidden'): void {
  authLogger.warn(event, buildAuthContext(req, reason));
  res.status(403).json({ error: reason });
}

function buildAuthContext(req: Request, reason: string): Record<string, unknown> {
  return {
    reason,
    method: req.method,
    requestUri: req.originalUrl || req.url,
    ip: req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '-',
    userAgent: req.headers['user-agent'] ?? '-'
  };
}
