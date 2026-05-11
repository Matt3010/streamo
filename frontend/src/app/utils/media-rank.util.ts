export interface MediaRankBadgeData {
  label: string;
  value: string;
  ariaLabel: string;
}

export function getMediaRankBadge(popularity?: number, voteCount?: number): MediaRankBadgeData | null {
  const score = popularity ?? 0;
  const votes = voteCount ?? 0;
  if (score < 80 || votes < 40) return null;

  const bucket = popularityToTopBucket(score);
  const value = formatBadgeValue(score);
  return {
    label: `Primi ${bucket}`,
    value,
    ariaLabel: `Stimato tra i primi ${bucket}, popolarita ${value}`
  };
}

function popularityToTopBucket(popularity: number): number {
  if (popularity >= 5000) return 10;
  if (popularity >= 2500) return 50;
  if (popularity >= 1400) return 100;
  if (popularity >= 800) return 250;
  if (popularity >= 400) return 500;
  if (popularity >= 200) return 1000;
  return 2500;
}

function formatBadgeValue(popularity: number): string {
  return Math.round(popularity).toLocaleString('it-IT');
}
