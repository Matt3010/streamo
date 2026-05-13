import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, OnInit } from '@angular/core';
import { faFileLines } from '@fortawesome/free-solid-svg-icons';
import { SectionHeaderComponent } from '../../../ui/section-header/section-header.component';
import { AdminService } from '../../../services/admin.service';
import type { PlaybackLogEntry } from '../../../models';

@Component({
  selector: 'app-admin-playback-logs-tab',
  standalone: true,
  imports: [SectionHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="admin-section">
      <div class="section-header">
        <div class="section-heading">
          <app-section-header title="Playback Logs" [icon]="playbackLogsIcon" />
          <span class="section-caption">
            File: {{ admin.playbackLogPath() || '/data/playback.log' }} | Ultimi {{ admin.playbackLogCapacity() }}
          </span>
        </div>
        <span class="live-pill" [class.connected]="admin.playbackLogsLiveConnected()">
          <span class="live-pill-dot" aria-hidden="true"></span>
          <span>{{ admin.playbackLogsLiveConnected() ? 'Socket log attivo' : 'Socket log non connesso' }}</span>
        </span>
      </div>

      @if (playbackLogsDesc().length === 0) {
        <p class="empty">Nessun log playback presente</p>
      } @else {
        <div class="logs-panel">
          <ul class="log-list">
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
          </ul>
        </div>
      }
    </section>
  `,
  styleUrl: './admin-playback-logs-tab.component.css'
})
export class AdminPlaybackLogsTabComponent implements OnInit, OnDestroy {
  protected readonly admin = inject(AdminService);
  protected readonly playbackLogsIcon = faFileLines;
  protected readonly playbackLogsDesc = computed(() => [...this.admin.playbackLogs()].reverse());

  ngOnInit(): void {
    void this.admin.fetchPlaybackLogs();
    this.admin.connectPlaybackLogsLive();
  }

  ngOnDestroy(): void {
    this.admin.disconnectPlaybackLogsLive();
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

  protected playbackLogTone(log: PlaybackLogEntry): 'ok' | 'info' | 'warn' | 'error' | 'cancelled' {
    const message = log.message.toLowerCase();
    if (message.includes(' status=499')) return 'cancelled';
    if (message.includes('fetch-error') || message.includes('write-error') || message.includes('read-error') || message.includes(' status=5')) return 'error';
    if (message.includes(' status=4')) return 'warn';
    if (message.includes('status=200') || message.includes(' playlist=yes') || message.includes(' master ') || message.includes(' media ')) return 'ok';
    return 'info';
  }

  protected playbackLogLabel(log: PlaybackLogEntry): string {
    const tone = this.playbackLogTone(log);
    return tone === 'ok' ? 'OK' : tone === 'warn' ? 'WARN' : tone === 'error' ? 'ERR' : tone === 'cancelled' ? 'CANCELLED' : 'INFO';
  }
}
