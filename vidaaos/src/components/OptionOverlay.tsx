import { useEffect } from 'preact/hooks';
import { Focusable } from '../spatial/Focusable';
import { pushBackHandler } from '../router/BackHandler';

export interface OptionItem {
  id: string | number;
  label: string;
  selected?: boolean;
}

export interface OptionOverlayProps {
  title: string;
  options: OptionItem[];
  onSelect: (id: string | number) => void;
  onClose: () => void;
}

export function OptionOverlay({
  title,
  options,
  onSelect,
  onClose
}: OptionOverlayProps) {
  useEffect(
    () => pushBackHandler(() => {
      onClose();
      return true;
    }),
    // ponytail: empty deps — install once, close on back.
    []
  );

  const firstSelected = options.findIndex((o) => o.selected);
  const defaultFocus = firstSelected >= 0 ? firstSelected : 0;

  return (
    <div class="overlay-scrim">
      <div class="overlay-card">
        <div class="overlay-title">{title}</div>
        <Focusable
          focusable={false}
          focusKey="option-overlay"
          trackChildren
          saveLastFocusedChild
          isFocusBoundary
          focusBoundaryDirections={['up', 'down', 'left', 'right']}
          className="overlay-list"
        >
          {options.map((o, i) => (
            <Focusable
              key={String(o.id)}
              fill
              ring
              forceFocus={i === defaultFocus}
              onSelect={() => onSelect(o.id)}
              className={`overlay-row${o.selected ? ' selected' : ''}`}
            >
              <span class="row-label">{o.label}</span>
              {o.selected && <span class="check">{'✓'}</span>}
            </Focusable>
          ))}
        </Focusable>
      </div>
    </div>
  );
}