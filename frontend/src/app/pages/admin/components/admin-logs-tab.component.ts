import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { faFileLines } from '@fortawesome/free-solid-svg-icons';
import { SectionHeaderComponent } from '../../../ui/section-header/section-header.component';
import { UiButtonDirective } from '../../../ui/ui-button.directive';
import { AdminService } from '../../../services/admin.service';
import type { PlaybackLogEntry, TransportLogEntry } from '../../../models';

type LogSource = 'playback' | 'transport';
type LogTone = 'ok' | 'info' | 'warn' | 'error' | 'cancelled';

@Component({
  selector: 'app-admin-logs-tab',
  standalone: true,
  imports: [SectionHeaderComponent, UiButtonDirective],
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
          <button uiButton="panel"
                  type="button"
                  [attr.aria-pressed]="selectedSource() === 'playback'"
                  (click)="selectSource('playback')">
            <span class="logs-source-title">Playback</span>
            <span class="logs-source-sub">{{ admin.playbackLogPath() || '/data/playback.log' }}</span>
          </button>

          <button uiButton="panel"
                  type="button"
                  [attr.aria-pressed]="selectedSource() === 'transport'"
                  (click)="selectSource('transport')">
            <span class="logs-source-title">Transport</span>
            <span class="logs-source-sub">{{ admin.transportLogPath() || '/data/nginx-playback-access.log' }}</span>
          </button>
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

          @if (selectedSource() === 'playback' && playbackLogsDesc().length === 0) {
            <p class="empty">Nessun log playback presente</p>
          } @else if (selectedSource() === 'transport' && transportLogsDesc().length === 0) {
            <p class="empty">Nessun log cdn/storage presente</p>
          } @else {
            <div class="logs-panel">
              <ul class="log-list">
                @if (selectedSource() === 'playback') {
                  @for (log of playbackLogsDesc(); track trackPlaybackLog($index, log)) {
                    <li class="log-row" [class.log-row-error]="playbackLogTone(log) === 'error'" [class.log-row-warn]="playbackLogTone(log) === 'warn'" [class.log-row-cancelled]="playbackLogTone(log) === 'cancelled'">
                      <span class="log-time">{{ formatPlaybackLogTime(log.ts) }}</span>
                      <div class="log-stack">
                        <div class="log-header">
                          <span class="log-badge" [class.log-badge-ok]="playbackLogTone(log) === 'ok'" [class.log-badge-info]="playbackLogTone(log) === 'info'" [class.log-badge-warn]="playbackLogTone(log) === 'warn'" [class.log-badge-error]="playbackLogTone(log) === 'error'" [class.log-badge-cancelled]="playbackLogTone(log) === 'cancelled'">
                            {{ playbackLogLabel(log) }}
                          </span>
                        </div>
                        <code class="log-message">{{ log.message }}</code>
                      </div>
                    </li>
                  }
                } @else {
                  @for (log of transportLogsDesc(); track trackTransportLog($index, log)) {
                    <li class="log-row" [class.log-row-error]="transportLogTone(log) === 'error'" [class.log-row-warn]="transportLogTone(log) === 'warn'" [class.log-row-cancelled]="transportLogTone(log) === 'cancelled'">
                      <span class="log-time">{{ log.ts }}</span>
                      <div class="log-stack">
                        <div class="log-header">
                          <span class="log-badge" [class.log-badge-ok]="transportLogTone(log) === 'ok'" [class.log-badge-info]="transportLogTone(log) === 'info'" [class.log-badge-warn]="transportLogTone(log) === 'warn'" [class.log-badge-error]="transportLogTone(log) === 'error'" [class.log-badge-cancelled]="transportLogTone(log) === 'cancelled'">
                            {{ transportLogLabel(log) }}
                          </span>
                        </div>
                        <code class="log-message">{{ transportLogSummary(log) }}</code>
                        <code class="log-detail">{{ log.request_uri }}</code>
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
  protected readonly selectedSource = signal<LogSource>('playback');
  protected readonly playbackLogsDesc = computed(() => [...this.admin.playbackLogs()].reverse());
  protected readonly transportLogsDesc = computed(() => [...this.admin.transportLogs()].reverse());
  protected readonly selectedTitle = computed(() => this.selectedSource() === 'playback' ? 'Playback' : 'Transport');
  protected readonly selectedPath = computed(() =>
    this.selectedSource() === 'playback'
      ? this.admin.playbackLogPath() || '/data/playback.log'
      : this.admin.transportLogPath() || '/data/nginx-playback-access.log'
  );
  protected readonly selectedCapacity = computed(() =>
    this.selectedSource() === 'playback' ? this.admin.playbackLogCapacity() : this.admin.transportLogCapacity()
  );
  protected readonly selectedConnected = computed(() =>
    this.selectedSource() === 'playback' ? this.admin.playbackLogsLiveConnected() : this.admin.transportLogsLiveConnected()
  );

  ngOnInit(): void {
    void this.admin.fetchPlaybackLogs();
    void this.admin.fetchTransportLogs();
    this.admin.connectPlaybackLogsLive();
    this.admin.connectTransportLogsLive();
  }

  ngOnDestroy(): void {
    this.admin.disconnectPlaybackLogsLive();
    this.admin.disconnectTransportLogsLive();
  }

  protected selectSource(source: LogSource): void {
    this.selectedSource.set(source);
  }

  protected formatPlaybackLogTime(timestampMs: number): string {
    return new Date(timestampMs).toLocaleString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  protected trackPlaybackLog(_index: number, log: PlaybackLogEntry): string {
    return `${log.ts}:${log.message}`;
  }

  protected playbackLogTone(log: PlaybackLogEntry): LogTone {
    const message = log.message.toLowerCase();
    if (message.includes(' status=499')) return 'cancelled';
    if (message.includes('fetch-error') || message.includes('write-error') || message.includes('read-error') || message.includes(' status=5')) return 'error';
    if (message.includes(' status=4')) return 'warn';
    if (message.includes('status=200') || message.includes(' playlist=yes') || message.includes(' master ') || message.includes(' media ')) return 'ok';
    return 'info';
  }

  protected playbackLogLabel(log: PlaybackLogEntry): string {
    return this.logLabel(this.playbackLogTone(log));
  }

  protected trackTransportLog(_index: number, log: TransportLogEntry): string {
    return `${log.ts}:${log.kind}:${log.request_uri}:${log.status}:${log.upstream_status}`;
  }

  protected transportLogSummary(log: TransportLogEntry): string {
    return `${log.kind.toUpperCase()} ${log.status} upstream=${log.upstream_status} host=${log.upstream_host} rt=${log.request_time}s urt=${log.upstream_response_time}s`;
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

  protected transportLogLabel(log: TransportLogEntry): string {
    return this.logLabel(this.transportLogTone(log));
  }

  private logLabel(tone: LogTone): string {
    return tone === 'ok' ? 'OK' : tone === 'warn' ? 'WARN' : tone === 'error' ? 'ERR' : tone === 'cancelled' ? 'CANCELLED' : 'INFO';
  }
}
