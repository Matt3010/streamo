import { Injectable, signal, computed } from '@angular/core';
import type { User } from '../models';

interface AuthResponse {
  user?: User;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly currentUser = signal<User | null>(null);
  readonly isLoggedIn = computed(() => this.currentUser() !== null);

  async checkAuth(): Promise<void> {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json() as { user: User };
        this.currentUser.set(data.user);
      }
    } catch {}
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    return this.submitAuth('/api/auth/login', email, password);
  }

  async register(email: string, password: string): Promise<AuthResponse> {
    return this.submitAuth('/api/auth/register', email, password);
  }

  async logout(): Promise<void> {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    this.currentUser.set(null);
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

  private async submitAuth(endpoint: string, email: string, password: string): Promise<AuthResponse> {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json() as AuthResponse;
      if (res.ok && data.user) this.currentUser.set(data.user);
      return data;
    } catch {
      return { error: 'network_error' };
    }
  }
}
