import { Injectable, signal, computed } from '@angular/core';
import type { User } from '../models';
import { apiCall, apiGetJson, apiOk, jsonRequest } from '../utils/api.util';

interface AuthResponse {
  user?: User;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
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

  async register(email: string, password: string, token?: string): Promise<AuthResponse> {
    return this.submitAuth('/api/auth/register', email, password, token);
  }

  async logout(): Promise<void> {
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

  private async updatePreferences(preferences: Partial<Pick<User, 'autoplay_next' | 'folders_enabled'>>): Promise<boolean> {
    const ok = await apiOk('/api/user/preferences', jsonRequest('PUT', preferences));
    if (!ok) return false;
    const user = this.currentUser();
    if (user) this.currentUser.set({ ...user, ...preferences });
    return true;
  }

  private async submitAuth(endpoint: string, email: string, password: string, token?: string): Promise<AuthResponse> {
    const body: Record<string, string> = { email, password };
    if (token) body['token'] = token;
    // Server returns a useful body on both success (`{user}`) and failure
    // (`{error: 'invalid_credentials' | ...}`) — apiCall surfaces both.
    const { ok, data } = await apiCall<AuthResponse>(endpoint, jsonRequest('POST', body));
    this.authResolved.set(true);
    if (ok && data?.user) this.currentUser.set(data.user);
    return data ?? { error: 'network_error' };
  }
}
