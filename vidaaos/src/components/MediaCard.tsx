import type { TmdbItem } from '../data/tmdb/dto';
import { displayTitle, itemYear } from '../data/tmdb/dto';
import { TMDBImage, TmdbImageSize } from '../data/tmdb/TMDBImage';
import { settings } from '../data/settings';
import { Focusable } from '../spatial/Focusable';
import { type RailPosition, railArrowHandler } from '../spatial/railFocus';

export interface MediaCardProps {
  item: TmdbItem;
  onSelect: (item: TmdbItem) => void;
  focusKey?: string;
  forceFocus?: boolean;
  size?: TmdbImageSize;
  /** Boundary position inside the horizontal rail (TV nav guardrails). */
  railPosition?: RailPosition;
}

export function MediaCard({
  item,
  onSelect,
  focusKey,
  forceFocus,
  size = TmdbImageSize.W342,
  railPosition
}: MediaCardProps) {
  const url = TMDBImage.url(item.poster_path, size);
  const title = displayTitle(item);
  const year = itemYear(item);
  const bg = url
    ? `url(${url})`
    : 'var(--surface-2)';

  return (
    <Focusable
      scale={1.05}
      onSelect={() => onSelect(item)}
      onArrowPress={(d) => railArrowHandler(railPosition, d)}
      forceFocus={forceFocus}
      focusKey={focusKey}
      className="card-focus"
    >
      <div
        class="card-poster"
        style={{ backgroundImage: bg }}
      >
        {settings.showCardInfo.value && year != null && (
          <span class="badge year-badge">{year}</span>
        )}
      </div>
      <div class="card-label">{title}</div>
    </Focusable>
  );
}