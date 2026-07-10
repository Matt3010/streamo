import { SpatialNavigation } from '@noriginmedia/norigin-spatial-navigation-core';

/** Move focus to the app drawer (sidebar). */
export function focusDrawer(): void {
  void SpatialNavigation.setFocus('drawer');
}

export type RailPosition = 'first' | 'last' | undefined;

/**
 * TV rail boundary handler: pressing LEFT on the first card moves focus to the
 * sidebar, and pressing RIGHT on the last card stays inside the rail instead
 * of jumping to another list/row.
 */
export function railArrowHandler(
  position: RailPosition,
  direction: string
): boolean {
  if (position === 'first' && direction === 'left') {
    focusDrawer();
    return false;
  }
  if (position === 'last' && direction === 'right') {
    return false;
  }
  return true;
}
