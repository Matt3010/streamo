import { Injectable, signal } from '@angular/core';
import type { AdminTokenRow, AdminSession, PlaybackLogEntry } from '../models';

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

interface AdminPlaybackLogsSocketMessage extends PlaybackLogsResponse {
  type: 'playback-logs';
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  readonly tokens = signal<AdminTokenRow[]>([]);
  readonly sessions = signal<AdminSession[]>([]);
  readonly playbackLogs = signal<PlaybackLogEntry[]>([]);
  readonly playbackLogCapacity = signal(500);
  readonly playbackLogPath = signal('');
  readonly sessionsLiveConnected = signal(false);
  readonly playbackLogsLiveConnected = signal(false);
  readonly loading = signal(false);

  private sessionsSocket: WebSocket | null = null;
  private playbackLogsSocket: WebSocket | null = null;

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

  connectSessionsLive(): void {
    if (this.sessionsSocket && (this.sessionsSocket.readyState === WebSocket.OPEN || this.sessionsSocket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/api/admin/sessions/ws`;
    const socket = new WebSocket(url);
    this.sessionsSocket = socket;

    socket.addEventListener('open', () => {
      if (this.sessionsSocket !== socket) return;
      this.sessionsLiveConnected.set(true);
    });

    socket.addEventListener('message', (event) => {
      if (this.sessionsSocket !== socket) return;
      try {
        const message = JSON.parse(event.data as string) as AdminSessionsSocketMessage;
        if (message.type === 'sessions') {
          this.sessions.set(message.sessions);
        }
      } catch {}
    });

    socket.addEventListener('close', () => {
      if (this.sessionsSocket !== socket) return;
      this.sessionsLiveConnected.set(false);
      this.sessionsSocket = null;
    });

    socket.addEventListener('error', () => {
      if (this.sessionsSocket !== socket) return;
      this.sessionsLiveConnected.set(false);
    });
  }

  disconnectSessionsLive(): void {
    this.sessionsLiveConnected.set(false);
    if (!this.sessionsSocket) return;
    const socket = this.sessionsSocket;
    this.sessionsSocket = null;
    socket.close();
  }

  connectPlaybackLogsLive(): void {
    if (this.playbackLogsSocket && (this.playbackLogsSocket.readyState === WebSocket.OPEN || this.playbackLogsSocket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/api/admin/playback-logs/ws`;
    const socket = new WebSocket(url);
    this.playbackLogsSocket = socket;

    socket.addEventListener('open', () => {
      if (this.playbackLogsSocket !== socket) return;
      this.playbackLogsLiveConnected.set(true);
    });

    socket.addEventListener('message', (event) => {
      if (this.playbackLogsSocket !== socket) return;
      try {
        const message = JSON.parse(event.data as string) as AdminPlaybackLogsSocketMessage;
        if (message.type === 'playback-logs') {
          this.playbackLogs.set(message.logs);
          this.playbackLogCapacity.set(message.capacity);
          this.playbackLogPath.set(message.path);
        }
      } catch {}
    });

    socket.addEventListener('close', () => {
      if (this.playbackLogsSocket !== socket) return;
      this.playbackLogsLiveConnected.set(false);
      this.playbackLogsSocket = null;
    });

    socket.addEventListener('error', () => {
      if (this.playbackLogsSocket !== socket) return;
      this.playbackLogsLiveConnected.set(false);
    });
  }

  disconnectPlaybackLogsLive(): void {
    this.playbackLogsLiveConnected.set(false);
    if (!this.playbackLogsSocket) return;
    const socket = this.playbackLogsSocket;
    this.playbackLogsSocket = null;
    socket.close();
  }
}
