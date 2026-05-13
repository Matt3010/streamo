import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, OnInit } from '@angular/core';
import { faTowerBroadcast } from '@fortawesome/free-solid-svg-icons';
import { SectionHeaderComponent } from '../../../ui/section-header/section-header.component';
import { AdminService } from '../../../services/admin.service';
import type { TransportLogEntry } from '../../../models';

@Component({
  selector: 'app-admin-transport-logs-tab',
  standalone: true,
  imports: [SectionHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="admin-section">
      <div class="section-header">
        <div class="section-heading">
          <app-section-header title="Transport Logs" [icon]="transportLogsIcon" />
          <span class="section-caption">
            File: {{ admin.transportLogPath() || '/data/nginx-playback-access.log' }} | Ultimi {{ admin.transportLogCapacity() }}
          </span>
        </div>
        <span class="live-pill" [class.connected]="admin.transportLogsLiveConnected()">
          <span class="live-pill-dot" aria-hidden="true"></span>
          <span>{{ admin.transportLogsLiveConnected() ? 'Socket transport attivo' : 'Socket transport non connesso' }}</span>
        </span>
      </div>

      @if (transportLogsDesc().length === 0) {
        <p class="empty">Nessun log cdn/storage presente</p>
      } @else {
        <div class="logs-panel">
          <ul class="log-list">
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
          </ul>
        </div>
      }
    </section>
  `,
  styleUrl: './admin-transport-logs-tab.component.css'
})
export class AdminTransportLogsTabComponent implements OnInit, OnDestroy {
  protected readonly admin = inject(AdminService);
  protected readonly transportLogsIcon = faTowerBroadcast;
  protected readonly transportLogsDesc = computed(() => [...this.admin.transportLogs()].reverse());

  ngOnInit(): void {
    void this.admin.fetchTransportLogs();
    this.admin.connectTransportLogsLive();
  }

  ngOnDestroy(): void {
    this.admin.disconnectTransportLogsLive();
  }

  protected trackTransportLog(_index: number, log: TransportLogEntry): string {
    return `${log.ts}:${log.kind}:${log.request_uri}:${log.status}:${log.upstream_status}`;
  }

  protected transportLogSummary(log: TransportLogEntry): string {
    return `${log.kind.toUpperCase()} ${log.status} upstream=${log.upstream_status} host=${log.upstream_host} rt=${log.request_time}s urt=${log.upstream_response_time}s`;
  }

  protected transportLogTone(log: TransportLogEntry): 'ok' | 'info' | 'warn' | 'error' | 'cancelled' {
    if (log.status === 499) return 'cancelled';
    if (log.status >= 500) return 'error';
    if (log.status >= 400) return 'warn';
    if (log.upstream_status.includes('500') || log.upstream_status.includes('502') || log.upstream_status.includes('503') || log.upstream_status.includes('504')) return 'error';
    if (log.upstream_status.includes('404') || log.upstream_status.includes('401') || log.upstream_status.includes('403')) return 'warn';
    if (log.status >= 200 && log.status < 400) return 'ok';
    return 'info';
  }

  protected transportLogLabel(log: TransportLogEntry): string {
    const tone = this.transportLogTone(log);
    return tone === 'ok' ? 'OK' : tone === 'warn' ? 'WARN' : tone === 'error' ? 'ERR' : tone === 'cancelled' ? 'CANCELLED' : 'INFO';
  }
}
