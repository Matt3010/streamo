import type { TmdbEpisodeDetail } from '../data/tmdb/dto';
import { TMDBImage, TmdbImageSize } from '../data/tmdb/TMDBImage';
import { Focusable } from '../spatial/Focusable';
import { InlineIcon, ICON_PATHS } from './Icon';

export interface EpisodeCardProps {
  ep: TmdbEpisodeDetail;
  seasonNumber: number;
  status?: 'watched' | 'progress' | 'none';
  progress?: number;
  onSelect: (ep: TmdbEpisodeDetail) => void;
  focusKey?: string;
  forceFocus?: boolean;
}

export function EpisodeCard({
  ep,
  seasonNumber,
  status = 'none',
  progress,
  onSelect,
  focusKey,
  forceFocus
}: EpisodeCardProps) {
  void seasonNumber; // ponytail: reserved for future season-scoped affordances
  const url = TMDBImage.url(ep.still_path, TmdbImageSize.W300);
  const bg = url ? `url(${url})` : 'var(--surface-2)';

  return (
    <Focusable
      scale={1}
      onSelect={() => onSelect(ep)}
      forceFocus={forceFocus}
      focusKey={focusKey}
      className="card-focus"
    >
      <div class="card-still" style={{ backgroundImage: bg }}>
        <div class="card-gradient" />
        <span class="episode-play">
          <InlineIcon path={ICON_PATHS.playArrow} size={44} />
        </span>
        <span class="episode-num">{ep.episode_number}</span>
        {status === 'watched' && (
          <span class="episode-status">{'✓'}</span>
        )}
        {status === 'progress' && (
          <span class="episode-status">{`${Math.round(progress ?? 0)}%`}</span>
        )}
        {status !== 'none' && (
          <div class="progress-bar">
            <div class="fill" style={{ width: `${status === 'watched' ? 100 : progress ?? 0}%` }} />
          </div>
        )}
      </div>
      <div class="episode-name">{ep.name || `Episodio ${ep.episode_number}`}</div>
      <div class="episode-overview">{ep.overview || ''}</div>
    </Focusable>
  );
}
