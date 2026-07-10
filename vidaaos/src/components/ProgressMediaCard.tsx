import type { ProgressEntry } from '../data/db';
import { TMDBImage, TmdbImageSize } from '../data/tmdb/TMDBImage';
import { percent } from '../util/format';
import { Focusable } from '../spatial/Focusable';
import { type RailPosition, railArrowHandler } from '../spatial/railFocus';

export interface ProgressMediaCardProps {
  entry: ProgressEntry;
  onSelect: (entry: ProgressEntry) => void;
  focusKey?: string;
  forceFocus?: boolean;
  size?: TmdbImageSize;
  /** Boundary position inside the horizontal rail (TV nav guardrails). */
  railPosition?: RailPosition;
}

export function ProgressMediaCard({
  entry,
  onSelect,
  focusKey,
  forceFocus,
  size = TmdbImageSize.W342,
  railPosition
}: ProgressMediaCardProps) {
  const url = TMDBImage.url(entry.posterPath, size);
  const bg = url ? `url(${url})` : 'var(--surface-2)';
  const pct = percent(entry.positionSeconds, entry.durationSeconds);
  const isTv = entry.mediaType === 'tv';

  // Android TvProgressMediaCard: "{h}h {m}min rimasti" / "{m} min rimasti" /
  // "pochi secondi" under the title; null when no duration. Hardcoded Italian like Android.
  let remainingText: string | null = null;
  if (entry.durationSeconds > 0) {
    const remaining = Math.max(0, Math.floor(entry.durationSeconds - entry.positionSeconds));
    const h = Math.floor(remaining / 3600);
    const m = Math.floor((remaining % 3600) / 60);
    remainingText = h > 0 ? `${h}h ${m}min rimasti` : m > 0 ? `${m} min rimasti` : 'pochi secondi';
  }

  return (
    <Focusable
      scale={1.05}
      onSelect={() => onSelect(entry)}
      onArrowPress={(d) => railArrowHandler(railPosition, d)}
      forceFocus={forceFocus}
      focusKey={focusKey}
      className="card-focus"
    >
      <div class="card-poster" style={{ backgroundImage: bg }}>
        <div class="progress-gradient" />
        {isTv && (
          <span class="badge">{`S${entry.season} E${entry.episode}`}</span>
        )}
        <div class="progress-bar">
          <div class="fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div class="card-label">{entry.title}</div>
      {remainingText && <div class="card-sublabel">{remainingText}</div>}
    </Focusable>
  );
}