import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import { headerValue } from './util.js';

const DATA_DIR = process.env.ADDON_DATA_DIR || '/data';
const TOKEN_FILE = path.join(DATA_DIR, 'auth-token.txt');

// Protects the HLS proxy routes only — the Stremio endpoints (manifest,
// catalog, meta, stream) stay open so Gelato/Stremio can call them without
// configuration. The key keeps the playlist/segment proxy from being usable
// as an open relay.
export const authToken = ensureAuthToken();

export function requireKey(req: Request, res: Response, next: NextFunction): void {
  // `?key=` query fallback because players (Jellyfin clients, ffmpeg, AirPlay)
  // fetch stream URLs with NO custom headers. (We use `key`, not `token`,
  // because `token` is vixcloud's own CDN parameter.)
  const queryKey = typeof req.query.key === 'string' ? req.query.key.trim() : '';
  const candidate = bearerToken(req.headers.authorization)
    || headerValue(req.headers['x-addon-token'], '').trim()
    || queryKey;
  if (candidate && timingSafeEqual(candidate, authToken)) {
    next();
    return;
  }
  res.status(401).json({ error: 'unauthorized' });
}

function bearerToken(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function ensureAuthToken(): string {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(TOKEN_FILE)) {
    const existing = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (existing) {
      console.log(`[addon] auth token loaded from ${TOKEN_FILE}`);
      return existing;
    }
  }

  const token = crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(TOKEN_FILE, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(`[addon] auth token generated and saved to ${TOKEN_FILE}`);
  return token;
}
