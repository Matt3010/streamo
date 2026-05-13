import type { WatchlistStatus } from '../models';
import type { IconName } from '../ui/icon/icon.component';

export interface StatusTransition {
  next: WatchlistStatus;
  requiresConfirmation: boolean;
}

export interface StatusConfirmModal {
  title: string;
  message: string;
  warning: string;
  actionLabel: string;
}

export function getStatusTransition(current: WatchlistStatus | undefined): StatusTransition {
  if (current === 'done') return { next: 'todo', requiresConfirmation: false };
  if (current === 'in_progress') return { next: 'done', requiresConfirmation: true };
  return { next: 'in_progress', requiresConfirmation: false };
}

export function getStatusConfirmModal(itemTitle: string): StatusConfirmModal {
  return {
    title: 'Segna Come Visto',
    message: `Vuoi segnare ${itemTitle} come visto?`,
    warning: 'Il titolo verrà spostato nella sezione "Visto".',
    actionLabel: 'Segna come visto'
  };
}

export function getStatusButtonTitle(status: WatchlistStatus | undefined): string {
  if (status === 'done') return 'Segna da guardare';
  if (status === 'in_progress') return 'Segna come visto';
  return 'Segna come in corso';
}

export function getStatusButtonIcon(status: WatchlistStatus | undefined): IconName {
  if (status === 'done') return 'rotate-left';
  if (status === 'in_progress') return 'check';
  return 'play';
}

export function getStatusToastMessage(itemTitle: string, newStatus: WatchlistStatus): string {
  if (newStatus === 'todo') return `${itemTitle}: rimesso in "Da guardare"`;
  if (newStatus === 'in_progress') return `${itemTitle}: spostato in "In corso"`;
  return `${itemTitle}: segnato come visto`;
}
