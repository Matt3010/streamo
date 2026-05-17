import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { kdb, getJwtSecret } from '../db';
import { COOKIE_SECURE, TOKEN_TTL, SUPER_ADMIN_EMAIL } from '../config';

export interface AuthedUser {
  id: number;
  email: string;
}

export type AuthFailureReason = 'missing_token' | 'invalid_token' | 'access_revoked';

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

    if (isSuperAdminUser(user)) {
      return { user };
    }

    const inviteRow = await kdb
      .selectFrom('invite_tokens')
      .select('revoked_at')
      .where('used_by_user_id', '=', user.id)
      .executeTakeFirst();

    if (!inviteRow || inviteRow.revoked_at !== null) {
      return { user: null, error: 'access_revoked' };
    }

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
    if (result.error === 'access_revoked') {
      res.clearCookie('token', { path: '/' });
    }
    res.status(401).json({ error: result.error ?? 'unauthenticated' });
    return;
  }

  req.user = result.user;
  next();
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  void requireAuth(req, res, () => {
    if (!isSuperAdminUser(req.user)) {
      res.status(403).json({ error: 'forbidden' });
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
