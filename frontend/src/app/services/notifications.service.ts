import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { LiveSocketService, type LiveSocketController } from './live-socket.service';
import { apiGetJson, apiOk, jsonRequest } from '../utils/api.util';
import type {
  NotificationCreatedEvent,
  NotificationItem,
  NotificationListResponse
} from '../models';

const NOTIFICATIONS_LIMIT = 50;

@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly auth = inject(AuthService);
  private readonly liveSocket = inject(LiveSocketService);

  readonly items = signal<NotificationItem[]>([]);
  readonly unreadCount = signal(0);
  readonly hasUnread = computed(() => this.unreadCount() > 0);

  private readonly controller: LiveSocketController = this.liveSocket.create({
    path: '/api/user/notifications/ws',
    onConnected: () => {},
    onMessage: (event) => {
      try {
        const payload = JSON.parse(event.data as string) as NotificationCreatedEvent;
        if (payload.type !== 'notification-created') return;
        this.prepend(payload.notification);
      } catch {
        // Ignore malformed messages and keep the socket alive.
      }
    }
  });

  constructor() {
    effect(() => {
      const resolved = this.auth.authResolved();
      const user = this.auth.currentUser();

      if (!resolved) return;
      if (!user) {
        this.controller.disconnect();
        this.items.set([]);
        this.unreadCount.set(0);
        return;
      }

      this.controller.connect();
      void this.load();
    });
  }

  async load(): Promise<void> {
    const data = await apiGetJson<NotificationListResponse>(`/api/user/notifications?limit=${NOTIFICATIONS_LIMIT}`);
    if (!data) return;
    this.items.set(data.items);
    this.unreadCount.set(data.unread_count);
  }

  async markRead(id: number): Promise<void> {
    // Optimistic: drop unread state locally first so the badge feels snappy.
    // Roll back only on a 404 — a server-side row that's already read still
    // returns 200 OK in our route, so this only ever rolls back when the
    // row really doesn't exist for this user.
    const before = this.items();
    const target = before.find((n) => n.id === id);
    if (!target || target.read_at !== null) return;

    const now = Math.floor(Date.now() / 1000);
    this.items.set(before.map((n) => n.id === id ? { ...n, read_at: now } : n));
    this.unreadCount.update((c) => Math.max(0, c - 1));

    const ok = await apiOk(`/api/user/notifications/${id}/read`, jsonRequest('POST'));
    if (!ok) {
      this.items.set(before);
      this.unreadCount.update((c) => c + 1);
    }
  }

  async markAllRead(): Promise<void> {
    const before = this.items();
    if (this.unreadCount() === 0) return;

    const now = Math.floor(Date.now() / 1000);
    this.items.set(before.map((n) => n.read_at === null ? { ...n, read_at: now } : n));
    this.unreadCount.set(0);

    const ok = await apiOk('/api/user/notifications/read-all', jsonRequest('POST'));
    if (!ok) {
      this.items.set(before);
      void this.load();
    }
  }

  async remove(id: number): Promise<void> {
    const before = this.items();
    const target = before.find((n) => n.id === id);
    if (!target) return;

    this.items.set(before.filter((n) => n.id !== id));
    if (target.read_at === null) this.unreadCount.update((c) => Math.max(0, c - 1));

    const ok = await apiOk(`/api/user/notifications/${id}`, jsonRequest('DELETE'));
    if (!ok) {
      this.items.set(before);
      void this.load();
    }
  }

  private prepend(notification: NotificationItem): void {
    const existing = this.items();
    // Server-side dedupe makes duplicates rare but a reconnect can re-deliver
    // the same payload; guard the local list explicitly.
    if (existing.some((n) => n.id === notification.id)) return;

    const next = [notification, ...existing].slice(0, NOTIFICATIONS_LIMIT);
    this.items.set(next);
    if (notification.read_at === null) this.unreadCount.update((c) => c + 1);
  }
}
