/**
 * Parses a YYYY-MM-DD date string into a Date object (midnight local time).
 */
export function parseDateOnly(raw?: string | null): Date | null {
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Checks if a date is strictly in the future (after today).
 */
export function isFutureDate(date: Date): boolean {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return date.getTime() > today.getTime();
}

/**
 * Checks if a date string (YYYY-MM-DD) is strictly in the future.
 */
export function isFutureDateStr(dateStr: string): boolean {
  const date = parseDateOnly(dateStr);
  return date !== null && isFutureDate(date);
}

/**
 * Formats a date in Italian long format (e.g., "13 maggio 2026").
 */
export function formatDateLong(date: Date): string {
  return new Intl.DateTimeFormat('it-IT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(date);
}

/**
 * Formats a date in Italian short format (e.g., "13 mag").
 */
export function formatDateShort(date: Date): string {
  return new Intl.DateTimeFormat('it-IT', {
    day: 'numeric',
    month: 'short'
  }).format(date);
}
