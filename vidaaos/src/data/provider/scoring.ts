// Provider scoring + text helpers — port of ProviderClient.kt companion members.
// Pure functions, no I/O. Load-bearing thresholds.
import type { ProviderSearchTitle } from './models';

export const STRONG_MATCH_THRESHOLD = 170;
export const MIN_CANDIDATE_SCORE = 40;
export const MAX_STORED_CANDIDATES = 10;

export function score(candidate: ProviderSearchTitle, wantedTitle: string, wantedYear: number | null): number {
  const candTitle = candidate.name?.trim();
  if (!candTitle) return 0;
  const wantedNorm = normalizeTitle(wantedTitle);
  const candNorm = normalizeTitle(candTitle);
  if (wantedNorm === '' || candNorm === '') return 0;

  let s = tokenOverlapScore(wantedNorm, candNorm);
  if (candNorm === wantedNorm) s += 120;
  else if (candNorm.startsWith(wantedNorm) || wantedNorm.startsWith(candNorm)) s += 70;
  else if (candNorm.includes(wantedNorm) || wantedNorm.includes(candNorm)) s += 35;

  const candYear = extractYear(releaseDate(candidate));
  if (wantedYear != null && candYear != null) {
    if (candYear === wantedYear) s += 35;
    else if (Math.abs(candYear - wantedYear) === 1) s += 10;
    else s -= 20;
  }
  return s;
}

export function tokenOverlapScore(a: string, b: string): number {
  const aTokens = new Set(a.split(' '));
  const bTokens = new Set(b.split(' '));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let overlap = 0;
  for (const t of aTokens) if (bTokens.has(t)) overlap++;
  const total = Math.max(aTokens.size, bTokens.size);
  return Math.round((overlap / total) * 100);
}

export function normalizeTitle(value: string): string {
  const folded = value
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // strip diacritics
    .toLowerCase();
  const cleaned = folded.replace(/[^\p{L}\p{N}]/gu, ' ');
  return cleaned.split(' ').filter((t) => t !== '').join(' ');
}

export function normalizeType(value?: string | null): MediaType | null {
  if (value === 'movie') return 'movie';
  if (value === 'tv') return 'tv';
  return null;
}
type MediaType = 'movie' | 'tv';

export function releaseDate(title: ProviderSearchTitle): string | null {
  const translation = title.translations?.find(
    (t) => t.key === 'release_date' || t.key === 'last_air_date'
  );
  return translation?.value ?? title.lastAirDate ?? null;
}

export function extractYear(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /\b(\d{4})\b/.exec(value);
  return m ? Number(m[1]) : null;
}

export function decodeHTMLEntities(value: string): string {
  let s = value;
  const replacements: [string, string][] = [
    ['&quot;', '"'],
    ['&#34;', '"'],
    ['&apos;', "'"],
    ['&#039;', "'"],
    ['&#39;', "'"],
    ['&lt;', '<'],
    ['&gt;', '>'],
    ['&amp;', '&']
  ];
  for (const [from, to] of replacements) s = s.split(from).join(to);
  return s;
}

export function firstMatch(text: string, pattern: string): string | null {
  const regex = new RegExp(pattern, 'i');
  const m = regex.exec(text);
  if (!m) return null;
  return m.length > 1 ? m[1] : null;
}

// ponytail self-check: an exact match scores >= STRONG_MATCH_THRESHOLD.
export function demo() {
  const cand: ProviderSearchTitle = { id: 1, name: 'The Matrix', type: 'movie' };
  const s = score(cand, 'The Matrix', 1999);
  console.assert(s >= STRONG_MATCH_THRESHOLD, `exact match should be strong, got ${s}`);
  console.assert(normalizeTitle('Café Résumé') === 'cafe resume', `normalizeTitle diacritics: ${normalizeTitle('Café Résumé')}`);
  console.assert(extractYear('2024-01-01') === 2024, 'extractYear');
  console.log('scoring.ts demo: OK');
}

// ponytail: run the self-check only under Node (tsx). `typeof process` is safe
// in the browser (where `process` is undefined) so this never throws there.
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('scoring.ts')) demo();