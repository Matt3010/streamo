import { Injectable, inject, signal } from '@angular/core';
import type {
  AdminTokenRow,
  AdminSession,
  AuthLogEntry,
  PlaybackLogEntry,
  ProviderResolveLogEntry,
  TransportLogEntry,
  AdminQueueStatus
} from '../models';
import { LiveSocketService, type LiveSocketController } from './live-socket.service';

interface TokenCreateResponse {
  token: string;
  label: string | null;
  created_at: number;
}

interface RevokeResponse {
  ok: boolean;
  was_used: boolean;
  error?: string;
}

interface AdminSessionsSocketMessage {
  type: 'sessions';
  sessions: AdminSession[];
}

interface PlaybackLogsResponse {
  count: number;
  capacity: number;
  path: string;
  logs: PlaybackLogEntry[];
}

interface AuthLogsResponse {
  count: number;
  capacity: number;
  path: string;
  logs: AuthLogEntry[];
}

interface AdminAuthLogsSocketMessage extends AuthLogsResponse {
  type: 'auth-logs';
}

interface AdminPlaybackLogsSocketMessage extends PlaybackLogsResponse {
  type: 'playback-logs';
}

interface ProviderResolveLogsResponse {
  count: number;
  capacity: number;
  path: string;
  logs: ProviderResolveLogEntry[];
}

interface AdminProviderResolveLogsSocketMessage extends ProviderResolveLogsResponse {
  type: 'provider-resolve-logs';
}

interface TransportLogsResponse {
  count: number;
  capacity: number;
  path: string;
  logs: TransportLogEntry[];
}

interface AdminTransportLogsSocketMessage extends TransportLogsResponse {
  type: 'transport-logs';
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly liveSocket = inject(LiveSocketService);

  readonly tokens = signal<AdminTokenRow[]>([]);
  readonly sessions = signal<AdminSession[]>([]);
  readonly authLogs = signal<AuthLogEntry[]>([]);
  readonly authLogCapacity = signal(500);
  readonly authLogPath = signal('');
  readonly playbackLogs = signal<PlaybackLogEntry[]>([]);
  readonly playbackLogCapacity = signal(500);
  readonly playbackLogPath = signal('');
  readonly providerResolveLogs = signal<ProviderResolveLogEntry[]>([]);
  readonly providerResolveLogCapacity = signal(500);
  readonly providerResolveLogPath = signal('');
  readonly transportLogs = signal<TransportLogEntry[]>([]);
  readonly transportLogCapacity = signal(500);
  readonly transportLogPath = signal('');
  readonly queueStatus = signal<AdminQueueStatus | null>(null);
  readonly sessionsLiveConnected = signal(false);
  readonly authLogsLiveConnected = signal(false);
  readonly playbackLogsLiveConnected = signal(false);
  readonly providerResolveLogsLiveConnected = signal(false);
  readonly transportLogsLiveConnected = signal(false);
  readonly loading = signal(false);
  readonly queueStatusLoading = signal(false);

  private readonly sessionsSocket: LiveSocketController;
  private readonly authLogsSocket: LiveSocketController;
  private readonly playbackLogsSocket: LiveSocketController;
  private readonly providerResolveLogsSocket: LiveSocketController;
  private readonly transportLogsSocket: LiveSocketController;

  constructor() {
    this.sessionsSocket = this.liveSocket.create({
      path: '/api/admin/sessions/ws',
      onConnected: (connected) => this.sessionsLiveConnected.set(connected),
      onMessage: (event) => {
        try {
          const message = JSON.parse(event.data as string) as AdminSessionsSocketMessage;
          if (message.type === 'sessions') {
            this.sessions.set(message.sessions);
          }
        } catch {}
      }
    });

    this.authLogsSocket = this.liveSocket.create({
      path: '/api/admin/auth-logs/ws',
      onConnected: (connected) => this.authLogsLiveConnected.set(connected),
      onMessage: (event) => {
        try {
          const message = JSON.parse(event.data as string) as AdminAuthLogsSocketMessage;
          if (message.type === 'auth-logs') {
            this.authLogs.set(message.logs);
            this.authLogCapacity.set(message.capacity);
            this.authLogPath.set(message.path);
          }
        } catch {}
      }
    });

    this.playbackLogsSocket = this.liveSocket.create({
      path: '/api/admin/playback-logs/ws',
      onConnected: (connected) => this.playbackLogsLiveConnected.set(connected),
      onMessage: (event) => {
        try {
          const message = JSON.parse(event.data as string) as AdminPlaybackLogsSocketMessage;
          if (message.type === 'playback-logs') {
            this.playbackLogs.set(message.logs);
            this.playbackLogCapacity.set(message.capacity);
            this.playbackLogPath.set(message.path);
          }
        } catch {}
      }
    });

    this.providerResolveLogsSocket = this.liveSocket.create({
      path: '/api/admin/provider-resolve-logs/ws',
      onConnected: (connected) => this.providerResolveLogsLiveConnected.set(connected),
      onMessage: (event) => {
        try {
          const message = JSON.parse(event.data as string) as AdminProviderResolveLogsSocketMessage;
          if (message.type === 'provider-resolve-logs') {
            this.providerResolveLogs.set(message.logs);
            this.providerResolveLogCapacity.set(message.capacity);
            this.providerResolveLogPath.set(message.path);
          }
        } catch {}
      }
    });

    this.transportLogsSocket = this.liveSocket.create({
      path: '/api/admin/transport-logs/ws',
      onConnected: (connected) => this.transportLogsLiveConnected.set(connected),
      onMessage: (event) => {
        try {
          const message = JSON.parse(event.data as string) as AdminTransportLogsSocketMessage;
          if (message.type === 'transport-logs') {
            this.transportLogs.set(message.logs);
            this.transportLogCapacity.set(message.capacity);
            this.transportLogPath.set(message.path);
          }
        } catch {}
      }
    });
  }

  async fetchTokens(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await fetch('/api/admin/tokens');
      if (res.ok) {
        const data = await res.json() as { tokens: AdminTokenRow[] };
        this.tokens.set(data.tokens);
      }
    } finally {
      this.loading.set(false);
    }
  }

  async createToken(label?: string): Promise<TokenCreateResponse | null> {
    try {
      const res = await fetch('/api/admin/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label || null })
      });
      if (res.ok) {
        const data = await res.json() as TokenCreateResponse;
        // Refresh list
        await this.fetchTokens();
        return data;
      }
    } catch {}
    return null;
  }

  async revokeToken(token: string): Promise<RevokeResponse> {
    try {
      const res = await fetch(`/api/admin/tokens/${encodeURIComponent(token)}`, {
        method: 'DELETE'
      });
      const data = await res.json() as RevokeResponse;
      if (res.ok) {
        // Refresh list
        await this.fetchTokens();
      }
      return data;
    } catch {
      return { ok: false, was_used: false, error: 'network_error' };
    }
  }

  async reactivateToken(token: string): Promise<RevokeResponse> {
    try {
      const res = await fetch(`/api/admin/tokens/${encodeURIComponent(token)}/reactivate`, {
        method: 'PATCH'
      });
      const data = await res.json() as RevokeResponse;
      if (res.ok) {
        await this.fetchTokens();
      }
      return data;
    } catch {
      return { ok: false, was_used: false, error: 'network_error' };
    }
  }

  async deleteTokenPermanently(token: string): Promise<RevokeResponse> {
    try {
      const res = await fetch(`/api/admin/tokens/${encodeURIComponent(token)}/permanent`, {
        method: 'DELETE'
      });
      const data = await res.json() as RevokeResponse;
      if (res.ok) {
        await this.fetchTokens();
      }
      return data;
    } catch {
      return { ok: false, was_used: false, error: 'network_error' };
    }
  }

  async fetchSessions(): Promise<void> {
    try {
      const res = await fetch('/api/admin/sessions');
      if (res.ok) {
        const data = await res.json() as { sessions: AdminSession[] };
        this.sessions.set(data.sessions);
      }
    } catch {}
  }

  async fetchPlaybackLogs(): Promise<void> {
    try {
      const res = await fetch('/api/admin/playback-logs');
      if (res.ok) {
        const data = await res.json() as PlaybackLogsResponse;
        this.playbackLogs.set(data.logs);
        this.playbackLogCapacity.set(data.capacity);
        this.playbackLogPath.set(data.path);
      }
    } catch {}
  }

  async fetchAuthLogs(): Promise<void> {
    try {
      const res = await fetch('/api/admin/auth-logs');
      if (res.ok) {
        const data = await res.json() as AuthLogsResponse;
        this.authLogs.set(data.logs);
        this.authLogCapacity.set(data.capacity);
        this.authLogPath.set(data.path);
      }
    } catch {}
  }

  async fetchProviderResolveLogs(): Promise<void> {
    try {
      const res = await fetch('/api/admin/provider-resolve-logs');
      if (res.ok) {
        const data = await res.json() as ProviderResolveLogsResponse;
        this.providerResolveLogs.set(data.logs);
        this.providerResolveLogCapacity.set(data.capacity);
        this.providerResolveLogPath.set(data.path);
      }
    } catch {}
  }

  async fetchTransportLogs(): Promise<void> {
    try {
      const res = await fetch('/api/admin/transport-logs');
      if (res.ok) {
        const data = await res.json() as TransportLogsResponse;
        this.transportLogs.set(data.logs);
        this.transportLogCapacity.set(data.capacity);
        this.transportLogPath.set(data.path);
      }
    } catch {}
  }

  async fetchQueueStatus(): Promise<void> {
    this.queueStatusLoading.set(true);
    try {
      const res = await fetch('/api/admin/queue-status');
      if (res.ok) {
        const data = await res.json() as AdminQueueStatus;
        this.queueStatus.set(data);
      }
    } catch {} finally {
      this.queueStatusLoading.set(false);
    }
  }

  connectSessionsLive(): void {
    this.sessionsSocket.connect();
  }

  disconnectSessionsLive(): void {
    this.sessionsSocket.disconnect();
  }

  connectPlaybackLogsLive(): void {
    this.playbackLogsSocket.connect();
  }

  connectAuthLogsLive(): void {
    this.authLogsSocket.connect();
  }

  disconnectAuthLogsLive(): void {
    this.authLogsSocket.disconnect();
  }

  disconnectPlaybackLogsLive(): void {
    this.playbackLogsSocket.disconnect();
  }

  connectProviderResolveLogsLive(): void {
    this.providerResolveLogsSocket.connect();
  }

  disconnectProviderResolveLogsLive(): void {
    this.providerResolveLogsSocket.disconnect();
  }

  connectTransportLogsLive(): void {
    this.transportLogsSocket.connect();
  }

  disconnectTransportLogsLive(): void {
    this.transportLogsSocket.disconnect();
  }
}
