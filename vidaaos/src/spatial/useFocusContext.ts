import { useContext } from 'preact/hooks';
import { FocusContext } from './FocusContext';

// Returns the parent focus key for the calling component (from context).
export function useFocusContext(): string {
  return useContext(FocusContext);
}