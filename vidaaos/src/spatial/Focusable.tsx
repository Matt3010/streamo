import type { CSSProperties, ComponentChildren } from 'preact';
import { FocusContext } from './FocusContext';
import { useFocusable } from './useFocusable';
import { focusClasses, focusScaleVar } from './focusRing';

export interface FocusableProps {
  focusKey?: string;
  focusable?: boolean;
  // container behavior (rails, overlays): remember last focused child + restore
  saveLastFocusedChild?: boolean;
  trackChildren?: boolean;
  autoRestoreFocus?: boolean;
  isFocusBoundary?: boolean;
  focusBoundaryDirections?: ('up' | 'down' | 'left' | 'right')[];
  preferredChildFocusKey?: string;
  forceFocus?: boolean;
  scrollIntoView?: boolean | ScrollIntoViewOptions;
  // input
  onSelect?: () => void;
  onArrowPress?: (direction: string) => boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  // focus visuals
  scale?: number;
  frame?: boolean;
  ring?: boolean;
  fill?: boolean;
  // dom
  className?: string;
  style?: CSSProperties;
  tabIndex?: number;
  children?: ComponentChildren;
}

// Focusable = TvFocusable equivalent: a focusable + clickable Box that
// exposes focus state and draws the caller-chosen highlight (scale + ring).
// Always provides its focusKey as the parent context for descendants.
export function Focusable({
  focusKey,
  focusable,
  saveLastFocusedChild,
  trackChildren,
  autoRestoreFocus,
  isFocusBoundary,
  focusBoundaryDirections,
  preferredChildFocusKey,
  forceFocus,
  scrollIntoView,
  onSelect,
  onArrowPress,
  onFocus,
  onBlur,
  scale,
  frame,
  ring,
  fill,
  className,
  style,
  tabIndex,
  children
}: FocusableProps) {
  const { ref, focused, focusKey: resolvedKey } = useFocusable({
    focusKey,
    focusable,
    saveLastFocusedChild,
    trackChildren,
    autoRestoreFocus,
    isFocusBoundary,
    focusBoundaryDirections,
    preferredChildFocusKey,
    forceFocus,
    scrollIntoView,
    onEnterPress: onSelect ? () => onSelect() : undefined,
    onArrowPress: onArrowPress ? (d) => onArrowPress(d) : undefined,
    onFocus: onFocus ? () => onFocus() : undefined,
    onBlur: onBlur ? () => onBlur() : undefined
  });

  const cls = focusClasses(focused.value, { scale, frame, ring, fill, extra: className });
  const scaleStyle = focusScaleVar(scale);
  const mergedStyle = { ...scaleStyle, ...style };

  return (
    <div ref={ref as any} class={cls} style={mergedStyle} tabIndex={tabIndex}>
      <FocusContext.Provider value={resolvedKey}>{children}</FocusContext.Provider>
    </div>
  );
}
