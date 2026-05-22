import { Injectable, inject, signal } from '@angular/core';
import type { FirebaseApp } from 'firebase/app';
import type { Messaging } from 'firebase/messaging';
import { FIREBASE_CONFIG, VAPID_KEY, isFirebaseConfigured } from '../firebase-config';
import { apiOk, jsonRequest } from '../utils/api.util';
import { ToastService } from './toast.service';

const LAST_TOKEN_KEY = 'streamo.fcm.lastToken';
const SW_PATH = '/firebase-messaging-sw.js';

export type PushPermissionState = NotificationPermission | 'unsupported' | 'unconfigured';

// Firebase SDK is dynamically imported on first use so it stays out of the
// initial bundle. Users who never enable push (or who haven't configured
// Firebase server-side) never pay the ~60 kB transfer cost.
type FirebaseModules = {
  initializeApp: typeof import('firebase/app').initializeApp;
  getMessaging: typeof import('firebase/messaging').getMessaging;
  getToken: typeof import('firebase/messaging').getToken;
  deleteToken: typeof import('firebase/messaging').deleteToken;
  onMessage: typeof import('firebase/messaging').onMessage;
};

@Injectable({ providedIn: 'root' })
export class PushNotificationsService {
  private readonly toast = inject(ToastService);

  readonly permission = signal<PushPermissionState>(this.computeInitialPermission());
  readonly busy = signal(false);
  readonly enabled = signal(false);

  private firebaseApp: FirebaseApp | null = null;
  private messagingClient: Messaging | null = null;
  private foregroundUnsub: (() => void) | null = null;
  private firebaseModulesPromise: Promise<FirebaseModules> | null = null;

  constructor() {
    // Reflect the locally-cached token state: when the user already enabled
    // push in a previous session, the bell UI should show the toggle as on
    // even before they re-trigger enable(). The token is re-validated on
    // first send; if invalid the server prunes it.
    if (typeof window !== 'undefined' && window.localStorage?.getItem(LAST_TOKEN_KEY)) {
      this.enabled.set(true);
    }
  }

  isSupported(): boolean {
    return typeof window !== 'undefined'
      && 'Notification' in window
      && 'serviceWorker' in navigator
      && 'PushManager' in window;
  }

  async enable(): Promise<{ ok: boolean; reason?: string }> {
    if (!this.isSupported()) return { ok: false, reason: 'unsupported' };
    if (!isFirebaseConfigured()) return { ok: false, reason: 'unconfigured' };

    this.busy.set(true);
    try {
      const permission = await Notification.requestPermission();
      this.permission.set(permission);
      if (permission !== 'granted') {
        return { ok: false, reason: permission };
      }

      const registration = await this.registerServiceWorker();
      const fb = await this.loadFirebase();
      const messaging = await this.getMessagingClient(fb);
      if (!messaging || !registration || !fb) return { ok: false, reason: 'init_failed' };

      const token = await fb.getToken(messaging, {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: registration
      });
      if (!token) return { ok: false, reason: 'no_token' };

      const ok = await apiOk('/api/user/fcm/register', jsonRequest('POST', {
        token,
        user_agent: navigator.userAgent
      }));
      if (!ok) return { ok: false, reason: 'register_failed' };

      window.localStorage?.setItem(LAST_TOKEN_KEY, token);
      this.enabled.set(true);
      await this.attachForegroundListener(fb);
      return { ok: true };
    } catch (error) {
      console.error('[push] enable failed', error);
      return { ok: false, reason: 'exception' };
    } finally {
      this.busy.set(false);
    }
  }

  async disable(): Promise<void> {
    this.busy.set(true);
    try {
      const cached = window.localStorage?.getItem(LAST_TOKEN_KEY);

      // Tell the server first so future pushes stop, even if deleteToken
      // fails locally (the token may have already been rotated by Firebase).
      if (cached) {
        await apiOk('/api/user/fcm/unregister', jsonRequest('POST', { token: cached }));
      }

      // Only touch the Firebase SDK if it was already loaded — there's no
      // need to drag the bundle in just to call deleteToken when the local
      // token cache is already authoritative.
      if (this.messagingClient && this.firebaseModulesPromise) {
        try {
          const fb = await this.firebaseModulesPromise;
          await fb.deleteToken(this.messagingClient);
        } catch (error) {
          console.warn('[push] deleteToken failed (token already gone?)', error);
        }
      }

      window.localStorage?.removeItem(LAST_TOKEN_KEY);
      this.detachForegroundListener();
      this.enabled.set(false);
    } finally {
      this.busy.set(false);
    }
  }

  // Idempotent: safe to call repeatedly. Used at boot when the user has a
  // cached token, to set up the foreground listener without re-prompting.
  async resumeIfEnabled(): Promise<void> {
    if (!this.enabled() || !this.isSupported() || !isFirebaseConfigured()) return;
    if (Notification.permission !== 'granted') {
      // Permission was revoked outside of Streamo (browser settings); clean up.
      window.localStorage?.removeItem(LAST_TOKEN_KEY);
      this.enabled.set(false);
      return;
    }
    const fb = await this.loadFirebase();
    if (fb) await this.attachForegroundListener(fb);
  }

  private async loadFirebase(): Promise<FirebaseModules | null> {
    if (!isFirebaseConfigured()) return null;
    if (!this.firebaseModulesPromise) {
      this.firebaseModulesPromise = (async () => {
        const [app, messaging] = await Promise.all([
          import('firebase/app'),
          import('firebase/messaging')
        ]);
        return {
          initializeApp: app.initializeApp,
          getMessaging: messaging.getMessaging,
          getToken: messaging.getToken,
          deleteToken: messaging.deleteToken,
          onMessage: messaging.onMessage
        };
      })();
    }
    try {
      return await this.firebaseModulesPromise;
    } catch (error) {
      console.error('[push] firebase import failed', error);
      this.firebaseModulesPromise = null;
      return null;
    }
  }

  private async getMessagingClient(fb: FirebaseModules | null): Promise<Messaging | null> {
    if (!fb) return null;
    if (this.messagingClient) return this.messagingClient;
    try {
      this.firebaseApp = this.firebaseApp ?? fb.initializeApp(FIREBASE_CONFIG);
      this.messagingClient = fb.getMessaging(this.firebaseApp);
      return this.messagingClient;
    } catch (error) {
      console.error('[push] firebase init failed', error);
      return null;
    }
  }

  private async registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    try {
      // Firebase looks for /firebase-messaging-sw.js by default but
      // registering it explicitly lets us await readiness and surface
      // errors instead of silently degrading.
      const registration = await navigator.serviceWorker.register(SW_PATH);
      await navigator.serviceWorker.ready;
      return registration;
    } catch (error) {
      console.error('[push] SW registration failed', error);
      return null;
    }
  }

  private async attachForegroundListener(fb: FirebaseModules): Promise<void> {
    if (this.foregroundUnsub) return;
    const messaging = await this.getMessagingClient(fb);
    if (!messaging) return;

    this.foregroundUnsub = fb.onMessage(messaging, (payload) => {
      // Tab is in foreground; the OS suppresses the SW-rendered banner so
      // we surface our own toast instead. Body comes from the data-only or
      // notification payload — prefer notification.title/body when present.
      const title = payload.notification?.title;
      const body = payload.notification?.body ?? '';
      const text = title ? (body ? `${title} — ${body}` : title) : body;
      if (text) this.toast.show(text);
    });
  }

  private detachForegroundListener(): void {
    this.foregroundUnsub?.();
    this.foregroundUnsub = null;
  }

  private computeInitialPermission(): PushPermissionState {
    if (typeof window === 'undefined') return 'unsupported';
    if (!this.isSupported()) return 'unsupported';
    if (!isFirebaseConfigured()) return 'unconfigured';
    return Notification.permission;
  }
}
