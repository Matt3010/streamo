export function SkeletonCard({ kind = 'poster' }: { kind?: 'poster' | 'still' }) {
  const base = kind === 'poster' ? 'card-poster' : 'card-still';
  return <div class={`${base} skeleton`} aria-hidden="true" />;
}