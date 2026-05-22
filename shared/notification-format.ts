// Single source of truth for the user-facing copy of a notification.
// Used both by the server (FCM push payload) and the client (in-app bell),
// so a change in wording / future i18n keys touches one place.

import type { NotificationItem, NotificationPayload, NotificationType } from './types';

/** Subset of NotificationItem the formatter actually reads — lets callers
 *  pass partial inputs (e.g. an in-flight payload during creation) without
 *  conjuring a fake `id` / `created_at`. */
export interface NotificationFormatInput {
  type: NotificationType;
  title?: string | null;
  payload?: NotificationPayload | null;
}

export function formatNotificationTitle(n: NotificationFormatInput): string {
  return n.title ?? defaultLabelFor(n.type);
}

// Pool of "you finished the show" phrases. Picked deterministically by
// payload.flavor_index so the same notification renders the same line
// every time it's read (no flicker between push body and bell card).
const SERIES_COMPLETED_PHRASES = [
  'Hai finito tutti gli episodi',
  'Serie completata',
  'Capitolo chiuso',
  'Maratona conclusa',
  'Tutto visto, complimenti',
  'Hai chiuso il cerchio',
  'Fine corsa',
  'Visto fino all’ultimo episodio'
];

export function formatNotificationBody(n: NotificationFormatInput): string {
  const { season, episode, aired_delta, flavor_index } = n.payload ?? {};
  switch (n.type) {
    case 'new_season':
      return season ? `Nuova stagione disponibile (S${season})` : 'Nuova stagione disponibile';
    case 'new_episode':
      if (aired_delta && aired_delta > 1) return `${aired_delta} nuovi episodi`;
      if (season && episode) return `Nuovo episodio: S${season} E${episode}`;
      return 'Nuovo episodio disponibile';
    case 'resume_reminder':
      if (season && episode) return `Riprendi da S${season} E${episode}`;
      return 'Hai un titolo da finire';
    case 'series_completed': {
      const idx = typeof flavor_index === 'number' && flavor_index >= 0 ? flavor_index : 0;
      return SERIES_COMPLETED_PHRASES[idx % SERIES_COMPLETED_PHRASES.length];
    }
    case 'admin_alert':
      return n.payload?.detail ?? adminAlertDefaultDetail(n.payload?.kind);
  }
}

function adminAlertDefaultDetail(kind: string | undefined): string {
  switch (kind) {
    case 'worker': return 'Worker non risponde';
    case 'failed_jobs': return 'Ci sono job falliti in coda';
    case 'egress': return 'Egress WARP non raggiungibile';
    case 'provider': return 'Provider non disponibile da troppo tempo';
    case 'fcm_credentials': return 'Firebase non accetta le credenziali';
    default: return 'Anomalia rilevata';
  }
}

/** Convenience for callers that need both at once (typical FCM payload). */
export function formatNotification(n: NotificationFormatInput): { title: string; body: string } {
  return {
    title: formatNotificationTitle(n),
    body: formatNotificationBody(n)
  };
}

/** Stable, same-origin path used as the deep link target. Both the server
 *  (in the FCM `click_url` data field) and the bell (router.navigate)
 *  build the URL from this single helper. Admin alerts have no TMDB
 *  context (sentinel tmdb_id 1..5), so they route to the admin tab
 *  instead of a non-existent /watch/tv/1 page. */
export function notificationTargetPath(
  n: Pick<NotificationItem, 'media_type' | 'tmdb_id' | 'type'>
): string {
  if (n.type === 'admin_alert') return '/admin';
  return `/watch/${n.media_type}/${n.tmdb_id}`;
}

function defaultLabelFor(type: NotificationType): string {
  switch (type) {
    case 'new_episode': return 'Nuovo episodio';
    case 'new_season': return 'Nuova stagione';
    case 'resume_reminder': return 'Riprendi a guardare';
    case 'series_completed': return 'Serie finita';
    case 'admin_alert': return 'Anomalia di sistema';
  }
}
