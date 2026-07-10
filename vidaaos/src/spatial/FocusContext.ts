import { createContext } from 'preact';
import type { VNode } from 'preact';
import { ROOT_FOCUS_KEY } from '@noriginmedia/norigin-spatial-navigation-core';

// Parent focus key context. Every Focusable provides its own focusKey so
// descendant focusables register as children (mirrors Norigin's React
// FocusContext.Provider). Defaults to ROOT_FOCUS_KEY at the app root.
export const FocusContext = createContext<string>(ROOT_FOCUS_KEY);

export type FocusContextProps = { value: string; children: VNode[] };