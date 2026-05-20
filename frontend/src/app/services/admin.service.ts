import { Injectable, inject, signal, type WritableSignal } from '@angular/core';
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

interface LogStreamConfig<T> {
  wsPath: string;
  fetchPath: string;
  messageType: string;
  logsSignal: WritableSignal<T[]>;
  capacitySignal: WritableSignal<number>;
  pathSignal: WritableSignal<string>;
  connectedSignal: WritableSignal<boolean>;
}

interface LogsPayload<T> {
  count: number;
  capacity: number;
  path: string;
  logs: T[];
}

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

    this.authLogsSocket = this.createLogStreamSocket(this.authLogStreamConfig);
    this.playbackLogsSocket = this.createLogStreamSocket(this.playbackLogStreamConfig);
    this.providerResolveLogsSocket = this.createLogStreamSocket(this.providerResolveLogStreamConfig);
    this.transportLogsSocket = this.createLogStreamSocket(this.transportLogStreamConfig);
  }

  private get authLogStreamConfig(): LogStreamConfig<AuthLogEntry> {
    return {
      wsPath: '/api/admin/auth-logs/ws',
      fetchPath: '/api/admin/auth-logs',
      messageType: 'auth-logs',
      logsSignal: this.authLogs,
      capacitySignal: this.authLogCapacity,
      pathSignal: this.authLogPath,
      connectedSignal: this.authLogsLiveConnected
    };
  }

  private get playbackLogStreamConfig(): LogStreamConfig<PlaybackLogEntry> {
    return {
      wsPath: '/api/admin/playback-logs/ws',
      fetchPath: '/api/admin/playback-logs',
      messageType: 'playback-logs',
      logsSignal: this.playbackLogs,
      capacitySignal: this.playbackLogCapacity,
      pathSignal: this.playbackLogPath,
      connectedSignal: this.playbackLogsLiveConnected
    };
  }

  private get providerResolveLogStreamConfig(): LogStreamConfig<ProviderResolveLogEntry> {
    return {
      wsPath: '/api/admin/provider-resolve-logs/ws',
      fetchPath: '/api/admin/provider-resolve-logs',
      messageType: 'provider-resolve-logs',
      logsSignal: this.providerResolveLogs,
      capacitySignal: this.providerResolveLogCapacity,
      pathSignal: this.providerResolveLogPath,
      connectedSignal: this.providerResolveLogsLiveConnected
    };
  }

  private get transportLogStreamConfig(): LogStreamConfig<TransportLogEntry> {
    return {
      wsPath: '/api/admin/transport-logs/ws',
      fetchPath: '/api/admin/transport-logs',
      messageType: 'transport-logs',
      logsSignal: this.transportLogs,
      capacitySignal: this.transportLogCapacity,
      pathSignal: this.transportLogPath,
      connectedSignal: this.transportLogsLiveConnected
    };
  }

  private createLogStreamSocket<T>(cfg: LogStreamConfig<T>): LiveSocketController {
    return this.liveSocket.create({
      path: cfg.wsPath,
      onConnected: (connected) => cfg.connectedSignal.set(connected),
      onMessage: (event) => {
        try {
          const message = JSON.parse(event.data as string) as LogsPayload<T> & { type: string };
          if (message.type === cfg.messageType) {
            cfg.logsSignal.set(message.logs);
            cfg.capacitySignal.set(message.capacity);
            cfg.pathSignal.set(message.path);
          }
        } catch {}
      }
    });
  }

  private async fetchLogStream<T>(cfg: LogStreamConfig<T>): Promise<void> {
    try {
      const res = await fetch(cfg.fetchPath);
      if (res.ok) {
        const data = await res.json() as LogsPayload<T>;
        cfg.logsSignal.set(data.logs);
        cfg.capacitySignal.set(data.capacity);
        cfg.pathSignal.set(data.path);
      }
    } catch {}
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
    return this.fetchLogStream(this.playbackLogStreamConfig);
  }

  async fetchAuthLogs(): Promise<void> {
    return this.fetchLogStream(this.authLogStreamConfig);
  }

  async fetchProviderResolveLogs(): Promise<void> {
    return this.fetchLogStream(this.providerResolveLogStreamConfig);
  }

  async fetchTransportLogs(): Promise<void> {
    return this.fetchLogStream(this.transportLogStreamConfig);
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
