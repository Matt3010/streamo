import { JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { faFileLines } from '@fortawesome/free-solid-svg-icons';
import { SectionHeaderComponent } from '../../../ui/section-header/section-header.component';
import { UiButtonDirective } from '../../../ui/ui-button.directive';
import { AdminService } from '../../../services/admin.service';
import type { AuthLogEntry, PlaybackLogEntry, ProviderResolveLogEntry, TransportLogEntry } from '../../../models';

type LogSource = 'auth' | 'playback' | 'provider' | 'transport';
type LogTone = 'ok' | 'info' | 'warn' | 'error' | 'cancelled';
type DomainLogEntry = AuthLogEntry | PlaybackLogEntry | ProviderResolveLogEntry;

interface ToneRule {
  keywords: readonly string[];
  tone: LogTone;
}

interface LogSourceConfig {
  source: LogSource;
  title: string;
  defaultPath: string;
}

const AUTH_TONE_RULES: readonly ToneRule[] = [
  { keywords: ['level=error'], tone: 'error' },
  { keywords: ['level=warn'], tone: 'warn' },
  { keywords: ['access_revoked', 'super_admin_required', 'forbidden'], tone: 'error' },
  { keywords: ['missing_token', 'invalid_token', 'unauthenticated'], tone: 'warn' }
];

const PLAYBACK_TONE_RULES: readonly ToneRule[] = [
  { keywords: ['level=error'], tone: 'error' },
  { keywords: ['level=warn'], tone: 'warn' },
  { keywords: [' status=499'], tone: 'cancelled' },
  { keywords: ['fetch-error', 'write-error', 'read-error', ' status=5'], tone: 'error' },
  { keywords: [' status=4'], tone: 'warn' },
  {
    keywords: [
      'level=info event=playlist upstream response',
      'level=info event=playlist master',
      'level=info event=playlist media',
      'status=200',
      ' playlist=yes',
      ' master ',
      ' media '
    ],
    tone: 'ok'
  }
];

const PROVIDER_TONE_RULES: readonly ToneRule[] = [
  { keywords: ['level=error'], tone: 'error' },
  { keywords: ['level=warn'], tone: 'warn' },
  { keywords: ['status=499'], tone: 'cancelled' },
  { keywords: ['fetch failed', 'invalid', 'missing ', 'unexpected ', ' status=5'], tone: 'error' },
  { keywords: ['failed', 'low_confidence', 'no_match', ' status=4'], tone: 'warn' },
  { keywords: ['resolved', 'auto_confirmed', 'status=200'], tone: 'ok' }
];

const LOG_SOURCES: readonly LogSourceConfig[] = [
  { source: 'auth', title: 'Auth', defaultPath: '/data/auth.log' },
  { source: 'playback', title: 'Playback', defaultPath: '/data/playback.log' },
  { source: 'provider', title: 'Provider Resolve', defaultPath: '/data/provider-resolve.log' },
  { source: 'transport', title: 'Transport', defaultPath: '/data/nginx-playback-access.log' }
];

const EMPTY_MESSAGES: Record<LogSource, string> = {
  auth: 'Nessun log auth presente',
  playback: 'Nessun log playback presente',
  provider: 'Nessun log resolver provider presente',
  transport: 'Nessun log cdn/storage presente'
};

function matchTone(message: string, rules: readonly ToneRule[]): LogTone {
  const lower = message.toLowerCase();
  for (const rule of rules) {
    if (rule.keywords.some((keyword) => lower.includes(keyword))) {
      return rule.tone;
    }
  }
  return 'info';
}

@Component({
  selector: 'app-admin-logs-tab',
  standalone: true,
  imports: [JsonPipe, SectionHeaderComponent, UiButtonDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="admin-section">
      <div class="section-header">
        <app-section-header title="Log" [icon]="logsIcon" />
        <span class="live-pill" [class.connected]="selectedConnected()">
          <span class="live-pill-dot" aria-hidden="true"></span>
          <span>{{ selectedConnected() ? 'Stream log attivo' : 'Stream log non connesso' }}</span>
        </span>
      </div>

      <div class="logs-shell">
        <aside class="logs-sidebar" aria-label="Selezione log">
          @for (src of sources; track src.source) {
            <button uiButton="panel"
                    type="button"
                    [attr.aria-pressed]="selectedSource() === src.source"
                    (click)="selectSource(src.source)">
              <span class="logs-source-title">{{ src.title }}</span>
              <span class="logs-source-sub">{{ sourcePath(src) }}</span>
            </button>
          }
        </aside>

        <div class="logs-view">
          <div class="section-header logs-view-header">
            <div class="section-heading">
              <span class="logs-view-title">{{ selectedTitle() }}</span>
              <span class="section-caption">
                File: {{ selectedPath() }} | Ultimi {{ selectedCapacity() }}
              </span>
            </div>
          </div>

          @if (isEmpty()) {
            <p class="empty">{{ emptyMessage() }}</p>
          } @else {
            <div class="logs-panel">
              <ul class="log-list">
                @if (selectedSource() === 'transport') {
                  @for (log of transportLogsDesc(); track trackTransportLog($index, log)) {
                    <li class="log-row"
                        [class.log-row-error]="transportLogTone(log) === 'error'"
                        [class.log-row-warn]="transportLogTone(log) === 'warn'"
                        [class.log-row-cancelled]="transportLogTone(log) === 'cancelled'">
                      <span class="log-time">{{ formatLogTime(log.ts) }}</span>
                      <div class="log-stack">
                        <div class="log-header">
                          <span class="log-badge"
                                [class.log-badge-ok]="transportLogTone(log) === 'ok'"
                                [class.log-badge-info]="transportLogTone(log) === 'info'"
                                [class.log-badge-warn]="transportLogTone(log) === 'warn'"
                                [class.log-badge-error]="transportLogTone(log) === 'error'"
                                [class.log-badge-cancelled]="transportLogTone(log) === 'cancelled'">
                            {{ logLabel(transportLogTone(log)) }}
                          </span>
                        </div>
                        <pre class="log-message">{{ log | json }}</pre>
                      </div>
                    </li>
                  }
                } @else {
                  @for (log of domainEntries(); track trackDomainLog($index, log)) {
                    <li class="log-row"
                        [class.log-row-error]="domainLogTone(log) === 'error'"
                        [class.log-row-warn]="domainLogTone(log) === 'warn'"
                        [class.log-row-cancelled]="domainLogTone(log) === 'cancelled'">
                      <span class="log-time">{{ formatLogTime(log.ts) }}</span>
                      <div class="log-stack">
                        <div class="log-header">
                          <span class="log-badge"
                                [class.log-badge-ok]="domainLogTone(log) === 'ok'"
                                [class.log-badge-info]="domainLogTone(log) === 'info'"
                                [class.log-badge-warn]="domainLogTone(log) === 'warn'"
                                [class.log-badge-error]="domainLogTone(log) === 'error'"
                                [class.log-badge-cancelled]="domainLogTone(log) === 'cancelled'">
                            {{ logLabel(domainLogTone(log)) }}
                          </span>
                        </div>
                        <pre class="log-message">{{ domainLogPayload(log) | json }}</pre>
                      </div>
                    </li>
                  }
                }
              </ul>
            </div>
          }
        </div>
      </div>
    </section>
  `,
  styleUrl: './admin-logs-tab.component.css'
})
export class AdminLogsTabComponent implements OnInit, OnDestroy {
  protected readonly admin = inject(AdminService);
  protected readonly logsIcon = faFileLines;
  protected readonly sources = LOG_SOURCES;
  protected readonly selectedSource = signal<LogSource>('playback');
  private readonly parsedDomainLogCache = new Map<string, unknown>();

  protected readonly authLogsDesc = computed(() => [...this.admin.authLogs()].reverse());
  protected readonly playbackLogsDesc = computed(() => [...this.admin.playbackLogs()].reverse());
  protected readonly providerResolveLogsDesc = computed(() => [...this.admin.providerResolveLogs()].reverse());
  protected readonly transportLogsDesc = computed(() => [...this.admin.transportLogs()].reverse());

  protected readonly domainEntries = computed<DomainLogEntry[]>(() => {
    switch (this.selectedSource()) {
      case 'auth': return this.authLogsDesc();
      case 'playback': return this.playbackLogsDesc();
      case 'provider': return this.providerResolveLogsDesc();
      default: return [];
    }
  });

  protected readonly isEmpty = computed(() =>
    this.selectedSource() === 'transport'
      ? this.transportLogsDesc().length === 0
      : this.domainEntries().length === 0
  );

  protected readonly emptyMessage = computed(() => EMPTY_MESSAGES[this.selectedSource()]);

  protected readonly selectedTitle = computed(() =>
    LOG_SOURCES.find((cfg) => cfg.source === this.selectedSource())?.title ?? ''
  );

  protected readonly selectedPath = computed(() => {
    const src = this.selectedSource();
    const defaultPath = LOG_SOURCES.find((cfg) => cfg.source === src)?.defaultPath ?? '';
    return this.adminLogPath(src) || defaultPath;
  });

  protected readonly selectedCapacity = computed(() => {
    switch (this.selectedSource()) {
      case 'auth': return this.admin.authLogCapacity();
      case 'playback': return this.admin.playbackLogCapacity();
      case 'provider': return this.admin.providerResolveLogCapacity();
      default: return this.admin.transportLogCapacity();
    }
  });

  protected readonly selectedConnected = computed(() => {
    switch (this.selectedSource()) {
      case 'auth': return this.admin.authLogsLiveConnected();
      case 'playback': return this.admin.playbackLogsLiveConnected();
      case 'provider': return this.admin.providerResolveLogsLiveConnected();
      default: return this.admin.transportLogsLiveConnected();
    }
  });

  private readonly domainToneRules = computed<readonly ToneRule[]>(() => {
    switch (this.selectedSource()) {
      case 'auth': return AUTH_TONE_RULES;
      case 'playback': return PLAYBACK_TONE_RULES;
      case 'provider': return PROVIDER_TONE_RULES;
      default: return [];
    }
  });

  ngOnInit(): void {
    void this.admin.fetchAuthLogs();
    void this.admin.fetchPlaybackLogs();
    void this.admin.fetchProviderResolveLogs();
    void this.admin.fetchTransportLogs();
    this.admin.connectAuthLogsLive();
    this.admin.connectPlaybackLogsLive();
    this.admin.connectProviderResolveLogsLive();
    this.admin.connectTransportLogsLive();
  }

  ngOnDestroy(): void {
    this.admin.disconnectAuthLogsLive();
    this.admin.disconnectPlaybackLogsLive();
    this.admin.disconnectProviderResolveLogsLive();
    this.admin.disconnectTransportLogsLive();
  }

  protected selectSource(source: LogSource): void {
    this.selectedSource.set(source);
  }

  protected sourcePath(src: LogSourceConfig): string {
    return this.adminLogPath(src.source) || src.defaultPath;
  }

  protected formatLogTime(ts: number | string): string {
    return new Date(ts).toLocaleString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  protected trackDomainLog(_index: number, log: DomainLogEntry): string {
    return `${log.ts}:${log.message}`;
  }

  protected trackTransportLog(_index: number, log: TransportLogEntry): string {
    return `${log.ts}:${log.kind}:${log.request_uri}:${log.status}:${log.upstream_status}:${log.denied_by}`;
  }

  protected domainLogTone(log: DomainLogEntry): LogTone {
    return matchTone(log.message, this.domainToneRules());
  }

  protected transportLogTone(log: TransportLogEntry): LogTone {
    if (log.status === 499) return 'cancelled';
    if (log.status >= 500) return 'error';
    if (log.status >= 400) return 'warn';
    if (log.upstream_status.includes('500') || log.upstream_status.includes('502') || log.upstream_status.includes('503') || log.upstream_status.includes('504')) return 'error';
    if (log.upstream_status.includes('404') || log.upstream_status.includes('401') || log.upstream_status.includes('403')) return 'warn';
    if (log.status >= 200 && log.status < 400) return 'ok';
    return 'info';
  }

  protected domainLogPayload(log: DomainLogEntry): unknown {
    const cached = this.parsedDomainLogCache.get(log.message);
    if (cached !== undefined) return cached;

    const parsed = this.parseDomainLogMessage(log.message);
    this.parsedDomainLogCache.set(log.message, parsed);
    return parsed;
  }

  protected logLabel(tone: LogTone): string {
    switch (tone) {
      case 'ok': return 'OK';
      case 'warn': return 'WARN';
      case 'error': return 'ERR';
      case 'cancelled': return 'CANCELLED';
      default: return 'INFO';
    }
  }

  private adminLogPath(src: LogSource): string {
    switch (src) {
      case 'auth': return this.admin.authLogPath();
      case 'playback': return this.admin.playbackLogPath();
      case 'provider': return this.admin.providerResolveLogPath();
      default: return this.admin.transportLogPath();
    }
  }

  private parseDomainLogMessage(message: string): unknown {
    const prefixMatch = /^\[([^\]]+)\]\s+(.*)$/.exec(message);
    if (!prefixMatch) {
      return { message };
    }

    const [, domain, rest0] = prefixMatch;
    let rest = rest0.trim();
    let level: string | null = null;
    let event = rest;
    let context: unknown = null;

    const levelMatch = /^level=([^\s]+)\s+(.*)$/.exec(rest);
    if (levelMatch) {
      level = levelMatch[1];
      rest = levelMatch[2].trim();
    }

    if (rest.startsWith('event=')) {
      const body = rest.slice('event='.length);
      const jsonStart = body.indexOf('{');
      if (jsonStart >= 0) {
        const candidateEvent = body.slice(0, jsonStart).trim();
        const candidateJson = body.slice(jsonStart).trim();
        try {
          context = JSON.parse(candidateJson);
          event = candidateEvent;
        } catch {
          event = body.trim();
        }
      } else {
        event = body.trim();
      }
    }

    return {
      domain,
      ...(level ? { level } : {}),
      event,
      ...(context !== null ? { context } : {}),
      raw: message
    };
  }
}
