import { Injectable, inject, signal, type WritableSignal } from '@angular/core';
import type {
  AuthLogEntry,
  PlaybackLogEntry,
  ProviderResolveLogEntry,
  TransportLogEntry,
  AdminQueueStatus,
  AdminEgressCheck
} from '../models';
import { LiveSocketService, type LiveSocketController } from './live-socket.service';
import { apiGetJson } from '../utils/api.util';

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

@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly liveSocket = inject(LiveSocketService);

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
  readonly egressCheck = signal<AdminEgressCheck | null>(null);
  readonly egressCheckLoading = signal(false);
  readonly authLogsLiveConnected = signal(false);
  readonly playbackLogsLiveConnected = signal(false);
  readonly providerResolveLogsLiveConnected = signal(false);
  readonly transportLogsLiveConnected = signal(false);
  readonly queueStatusLoading = signal(false);

  private readonly authLogsSocket: LiveSocketController;
  private readonly playbackLogsSocket: LiveSocketController;
  private readonly providerResolveLogsSocket: LiveSocketController;
  private readonly transportLogsSocket: LiveSocketController;

  constructor() {
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
    const data = await apiGetJson<LogsPayload<T>>(cfg.fetchPath);
    if (!data) return;
    cfg.logsSignal.set(data.logs);
    cfg.capacitySignal.set(data.capacity);
    cfg.pathSignal.set(data.path);
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
      const data = await apiGetJson<AdminQueueStatus>('/api/admin/queue-status');
      if (data) this.queueStatus.set(data);
    } finally {
      this.queueStatusLoading.set(false);
    }
  }

  async fetchEgressCheck(): Promise<void> {
    this.egressCheckLoading.set(true);
    try {
      const data = await apiGetJson<AdminEgressCheck>('/api/admin/egress-check');
      if (data) this.egressCheck.set(data);
    } finally {
      this.egressCheckLoading.set(false);
    }
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
