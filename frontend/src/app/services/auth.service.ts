import { Injectable, signal, computed } from '@angular/core';
import type { User } from '../models';

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
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json() as { user: User };
          this.currentUser.set(data.user);
        }
      } catch {} finally {
        this.authResolved.set(true);
      }
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
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    this.currentUser.set(null);
    this.authResolved.set(true);
    // Reset the cache so the next checkAuth() actually round-trips to
    // /api/auth/me instead of reusing the resolved promise from the
    // previous (logged-in) session.
    this.authCheckPromise = null;
  }

  async setAutoplay(enabled: 0 | 1): Promise<boolean> {
    try {
      const res = await fetch('/api/user/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoplay_next: enabled })
      });
      if (!res.ok) return false;
      const user = this.currentUser();
      if (user) this.currentUser.set({ ...user, autoplay_next: enabled });
      return true;
    } catch {
      return false;
    }
  }

  private async submitAuth(endpoint: string, email: string, password: string, token?: string): Promise<AuthResponse> {
    try {
      const body: Record<string, string> = { email, password };
      if (token) body['token'] = token;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json() as AuthResponse;
      this.authResolved.set(true);
      if (res.ok && data.user) this.currentUser.set(data.user);
      return data;
    } catch {
      this.authResolved.set(true);
      return { error: 'network_error' };
    }
  }
}
