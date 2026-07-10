import type { ComponentChildren } from 'preact';
import { Focusable } from '../spatial/Focusable';
import { strings } from '../i18n/strings';
import { InlineIcon, ICON_PATHS, SectionTitle } from './Icon';

export interface ImmersiveRowProps {
  title: string;
  focusKey: string;
  /** Material filled icon path data (24px viewBox). Renders the primary badge
   *  matching Android SectionHeader. Omit for no badge. */
  icon?: string;
  onMore?: () => void;
  empty?: boolean;
  emptyLabel?: string;
  children?: ComponentChildren;
}

export function ImmersiveRow({
  title,
  icon,
  onMore,
  empty,
  emptyLabel,
  children
}: ImmersiveRowProps) {
  return (
    <section class="rail">
      <SectionTitle title={title} icon={icon} />
      {empty ? (
        <div class="empty-row">{emptyLabel ?? ''}</div>
      ) : (
        // ponytail: rail come plain div (NON Focusable). Così le card registrano
        // parentFocusKey = `content` e diventano sibling di tutte le card su
        // schermo, esattamente come le grid-5 di Search/SectionList. La nav
        // verticale del core Norigin è allora geometrica card-to-card: atterra
        // sulla card più vicina in basso per posizione x (stile app Android /
        // Compose focus search), non row-to-row con saveLastFocusedChild — che su
        // row non toccati faceva atterrare su prima/ultima card. Il rail-row resta
        // lo scroll container orizzontale per scrollFocusedIntoView (carousel).
        // focusKey non è più usato qui (tenuto nell'interface per i caller che lo
        // derivano per le chiavi delle card, es. SectionRow `${focusKey}-item-…`).
        <div class="rail-row">
          {children}
          {onMore && (
            <Focusable
              scale={1.05}
              onSelect={onMore}
              onArrowPress={(d) => d !== 'right'}
              className="card-focus"
            >
              {/* Same poster shape as MediaCard so the trailing "Altro" card
                  has the exact same footprint as the other items in the rail. */}
              <div class="card-poster altro-poster">
                <InlineIcon path={ICON_PATHS.arrowForward} size={24} />
              </div>
              <div class="card-label">{strings.more}</div>
            </Focusable>
          )}
        </div>
      )}
    </section>
  );
}
