export interface MediaRankBadgeData {
  label: string;
  value: string;
  ariaLabel: string;
}

export function getMediaRankBadge(popularity?: number, voteCount?: number): MediaRankBadgeData | null {
  const score = popularity ?? 0;
  if (score <= 0) return null;
  const value = formatBadgeValue(score);
  return {
    label: 'Trending',
    value,
    ariaLabel: `Trending score ${value}`
  };
}

function formatBadgeValue(popularity: number): string {
  return Math.round(popularity).toLocaleString('it-IT');
}
