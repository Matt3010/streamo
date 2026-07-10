import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { HomeSection } from '../state/homeSections';
import { TMDBClient } from '../data/tmdb/TMDBClient';
import { useNav } from '../router/Router';
import { Focusable } from '../spatial/Focusable';
import { ImmersiveRow } from './ImmersiveRow';
import { MediaCard } from './MediaCard';
import { SkeletonCard } from './SkeletonCard';

export interface SectionRowProps {
  section: HomeSection;
  focusKey: string;
  forceFirstFocus?: boolean;
  onMore: () => void;
}

export function SectionRow({
  section,
  focusKey,
  forceFirstFocus,
  onMore
}: SectionRowProps) {
  const items = useSignal<import('../data/tmdb/dto').TmdbItem[]>([]);
  const loading = useSignal(true);
  const error = useSignal(false);
  const { navigate } = useNav();

  useEffect(() => {
    let cancelled = false;
    loading.value = true;
    error.value = false;
    TMDBClient.list(section.endpoint, 1)
      .then((r) => {
        if (cancelled) return;
        items.value = r;
        loading.value = false;
      })
      .catch(() => {
        if (cancelled) return;
        error.value = true;
        loading.value = false;
      });
    return () => {
      cancelled = true;
    };
  }, [section.endpoint]);

  if (loading.value) {
    return (
      <ImmersiveRow title={section.title} icon={section.icon} focusKey={focusKey}>
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonCard key={i} kind="poster" />
        ))}
      </ImmersiveRow>
    );
  }

  if (error.value || items.value.length === 0) {
    // Android TvHomeScreen renders a section row only if non-empty.
    return null;
  }

  return (
    <ImmersiveRow
      title={section.title}
      icon={section.icon}
      focusKey={focusKey}
      onMore={onMore}
    >
      {items.value.map((item, i) => (
        <MediaCard
          key={item.id}
          item={item}
          focusKey={`${focusKey}-item-${item.id}`}
          forceFocus={!!forceFirstFocus && i === 0}
          // ponytail: every SectionRow has an onMore 'Altro' card after the items,
          // so the last MediaCard is never the last focusable in the rail. Marking
          // it as 'last' would make railArrowHandler block RIGHT and leave the
          // trailing Altro card unreachable by D-pad.
          railPosition={i === 0 ? 'first' : undefined}
          onSelect={(it) =>
            navigate({
              name: 'detail',
              mediaType: section.mediaType,
              tmdbId: it.id
            })
          }
        />
      ))}
    </ImmersiveRow>
  );
}