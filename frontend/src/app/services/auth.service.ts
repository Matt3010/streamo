import { Injectable, inject, signal, computed } from '@angular/core';
import type { User } from '../models';
import { apiCall, apiGetJson, apiOk, jsonRequest } from '../utils/api.util';
import { PushNotificationsService } from './push-notifications.service';

interface AuthResponse {
  user?: User;
  error?: string;
}

type NotifPrefField = 'notif_new_episode' | 'notif_new_season' | 'notif_resume_reminder';
type PreferencePatch = Partial<Pick<User,
  'autoplay_next'
  | 'folders_enabled'
  | NotifPrefField
  | 'background_pattern_data_url'
>>;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly push = inject(PushNotificationsService);

  readonly currentUser = signal<User | null>(null);
  readonly authResolved = signal(false);
  readonly isLoggedIn = computed(() => this.currentUser() !== null);
  readonly isAdmin = computed(() => this.currentUser()?.is_admin === true);

  // Cached so route guards can `await checkAuth()` without re-issuing
  // /api/auth/me on every navigation. The first caller (AppComponent at
  // boot) starts the request; subsequent callers reuse the same promise.
  private authCheckPromise: Promise<void> | null = null;

  checkAuth(): Promise<void> {
    if (this.authCheckPromise) return this.authCheckPromise;
    this.authCheckPromise = (async () => {
      const data = await apiGetJson<{ user: User }>('/api/auth/me');
      if (data) this.currentUser.set(data.user);
      this.authResolved.set(true);
    })();
    return this.authCheckPromise;
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    return this.submitAuth('/api/auth/login', email, password);
  }

  async logout(): Promise<void> {
    // Drop the local push token before clearing auth — otherwise the
    // device keeps receiving notifications belonging to the user that
    // just logged out (or, after a different user logs in, the wrong
    // user's notifications).
    await this.push.disable();
    // Best-effort POST — clear local state regardless because the cookie
    // is httpOnly and we can't unset it ourselves.
    await apiOk('/api/auth/logout', jsonRequest('POST'));
    this.currentUser.set(null);
    this.authResolved.set(true);
    // Reset the cache so the next checkAuth() actually round-trips to
    // /api/auth/me instead of reusing the resolved promise from the
    // previous (logged-in) session.
    this.authCheckPromise = null;
  }

  async setAutoplay(enabled: 0 | 1): Promise<boolean> {
    return this.updatePreferences({ autoplay_next: enabled });
  }

  async setFoldersEnabled(enabled: 0 | 1): Promise<boolean> {
    return this.updatePreferences({ folders_enabled: enabled });
  }

  async setNotifPref(field: NotifPrefField, enabled: 0 | 1): Promise<boolean> {
    return this.updatePreferences({ [field]: enabled });
  }

  async setBackgroundPattern(dataUrl: string | null): Promise<boolean> {
    return this.updatePreferences({ background_pattern_data_url: dataUrl });
  }

  private async updatePreferences(preferences: PreferencePatch): Promise<boolean> {
    const ok = await apiOk('/api/user/preferences', jsonRequest('PUT', preferences));
    if (!ok) return false;
    const user = this.currentUser();
    if (user) this.currentUser.set({ ...user, ...preferences });
    return true;
  }

  private async submitAuth(endpoint: string, email: string, password: string): Promise<AuthResponse> {
    // Server returns a useful body on both success (`{user}`) and failure
    // (`{error: 'invalid_credentials' | ...}`) — apiCall surfaces both.
    const { ok, data } = await apiCall<AuthResponse>(endpoint, jsonRequest('POST', { email, password }));
    this.authResolved.set(true);
    if (ok && data?.user) this.currentUser.set(data.user);
    return data ?? { error: 'network_error' };
  }
}
