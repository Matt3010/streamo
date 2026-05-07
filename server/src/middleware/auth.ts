import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getOrCreateJwtSecret } from '../db';
import { COOKIE_SECURE, TOKEN_TTL } from '../config';

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
    next();
  } catch {
    res.status(401).json({ error: 'invalid_token' });
  }
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
