import type { Request } from 'express';

export type MediaType = 'movie' | 'tv';

export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = 8000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<string | null> {
  const response = await fetchWithTimeout(url, {
    headers,
    referrerPolicy: 'no-referrer'
  }, timeoutMs).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  return response.text().catch(() => null);
}

export function firstMatch(value: string, regex: RegExp): string | null {
  const match = value.match(regex);
  return match?.[1] ?? null;
}

export function extractAny(value: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = firstMatch(value, pattern);
    if (match) {
      return match;
    }
  }
  return null;
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&apos;|&#039;|&#39;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function toInt(value: unknown, min = 1): number | null {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n >= min ? n : null;
}

export function headerValue(value: string | string[] | undefined, fallback: string): string {
  if (Array.isArray(value)) {
    return value[0] ?? fallback;
  }
  return value ?? fallback;
}

export function normalizeMediaType(value: unknown): MediaType | null {
  return value === 'movie' || value === 'tv' ? value : null;
}

export function extractYear(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const match = value.match(/\b(\d{4})\b/);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function normalizeBaseURL(href: string): string | null {
  try {
    const url = new URL(href);
    const normalized = url.toString();
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  } catch {
    return null;
  }
}

export function requestBaseURL(req: Request): string {
  const proto = headerValue(req.headers['x-forwarded-proto'], req.protocol).split(',')[0].trim();
  return `${proto}://${req.get('host')}`;
}

export function redactAuthKey(url: string): string {
  return url.replace(/([?&]key=)[^&]*/gi, '$1***');
}

export function querySuffix(url: string): string {
  const start = url.indexOf('?');
  if (start < 0) return '';
  // Strip only OUR params (key) while keeping every other param byte-for-byte:
  // vixcloud signs `token`/`expires`, so re-encoding via URLSearchParams
  // (which canonicalizes +, /, =, %xx) could invalidate the CDN signature.
  const internal = new Set(['key']);
  const kept = url.slice(start + 1)
    .split('&')
    .filter((pair) => pair !== '' && !internal.has(pair.split('=')[0]));
  return kept.length ? `?${kept.join('&')}` : '';
}
