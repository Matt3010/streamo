import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db, getOrCreateJwtSecret } from '../db';
import { COOKIE_SECURE, TOKEN_TTL, SUPER_ADMIN_EMAIL } from '../config';

export const JWT_SECRET = process.env.JWT_SECRET || getOrCreateJwtSecret();

export interface AuthedUser {
  id: number;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.token;
  if (!token) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET) as AuthedUser;

    // Super admin bypasses revocation check
    if (SUPER_ADMIN_EMAIL && req.user.email.toLowerCase() === SUPER_ADMIN_EMAIL) {
      next();
      return;
    }

    // Check if user's invite token has been revoked
    const inviteRow = db.prepare(
      'SELECT revoked_at FROM invite_tokens WHERE used_by_user_id = ?'
    ).get(req.user.id) as { revoked_at: number | null } | undefined;

    if (!inviteRow || inviteRow.revoked_at !== null) {
      res.clearCookie('token', { path: '/' });
      res.status(401).json({ error: 'access_revoked' });
      return;
    }

    next();
  } catch {
    res.status(401).json({ error: 'invalid_token' });
  }
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (!SUPER_ADMIN_EMAIL || req.user?.email.toLowerCase() !== SUPER_ADMIN_EMAIL) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  });
}

export function setAuthCookie(res: Response, user: AuthedUser): void {
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
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
