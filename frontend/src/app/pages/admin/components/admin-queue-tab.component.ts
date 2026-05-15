import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { faTowerBroadcast } from '@fortawesome/free-solid-svg-icons';
import { SectionHeaderComponent } from '../../../ui/section-header/section-header.component';
import { IconComponent } from '../../../ui/icon/icon.component';
import { UiButtonDirective } from '../../../ui/ui-button.directive';
import { AdminService } from '../../../services/admin.service';

@Component({
  selector: 'app-admin-queue-tab',
  standalone: true,
  imports: [SectionHeaderComponent, IconComponent, UiButtonDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="admin-section">
      <div class="section-header">
        <app-section-header title="Queue e Worker" [icon]="queueIcon" />
        <div class="section-actions">
          <button uiButton="primary" [disabled]="admin.queueStatusLoading()" (click)="refresh()">Aggiorna</button>
          <a uiButton="icon"
             href="/api/admin/queues"
             target="_blank"
             rel="noopener noreferrer"
             aria-label="Apri dashboard code"
             title="Dashboard code">
            <app-icon name="list"></app-icon>
          </a>
        </div>
      </div>

      @if (admin.queueStatusLoading() && !queueStatus()) {
        <p class="loading">Caricamento...</p>
      } @else if (!queueStatus()) {
        <p class="empty">Stato coda non disponibile</p>
      } @else {
        <div class="queue-stats-grid">
          <div class="queue-stat-card">
            <span class="queue-stat-label">Worker online</span>
            <strong class="queue-stat-value">{{ queueStatus()!.workers.length }}</strong>
          </div>
          <div class="queue-stat-card">
            <span class="queue-stat-label">Waiting</span>
            <strong class="queue-stat-value">{{ queueStatus()!.counts.waiting }}</strong>
          </div>
          <div class="queue-stat-card">
            <span class="queue-stat-label">Active</span>
            <strong class="queue-stat-value">{{ queueStatus()!.counts.active }}</strong>
          </div>
          <div class="queue-stat-card">
            <span class="queue-stat-label">Delayed</span>
            <strong class="queue-stat-value">{{ queueStatus()!.counts.delayed }}</strong>
          </div>
          <div class="queue-stat-card">
            <span class="queue-stat-label">Failed</span>
            <strong class="queue-stat-value">{{ queueStatus()!.counts.failed }}</strong>
          </div>
          <div class="queue-stat-card">
            <span class="queue-stat-label">Completed</span>
            <strong class="queue-stat-value">{{ queueStatus()!.counts.completed }}</strong>
          </div>
        </div>

        <div class="queue-flags">
          <span class="live-pill" [class.connected]="queueStatus()!.redis_configured">
            <span class="live-pill-dot" aria-hidden="true"></span>
            <span>{{ queueStatus()!.redis_configured ? 'Redis configurato' : 'Redis non configurato' }}</span>
          </span>
          <span class="live-pill" [class.connected]="queueStatus()!.queue_available">
            <span class="live-pill-dot" aria-hidden="true"></span>
            <span>{{ queueStatus()!.queue_available ? 'Queue disponibile' : 'Queue non disponibile' }}</span>
          </span>
          <span class="live-pill" [class.connected]="queueStatus()!.scheduler_enabled">
            <span class="live-pill-dot" aria-hidden="true"></span>
            <span>{{ queueStatus()!.scheduler_enabled ? 'Scheduler attivo' : 'Scheduler disattivo' }}</span>
          </span>
        </div>

        @if (workers().length === 0) {
          <p class="empty">Nessun worker heartbeat registrato</p>
        } @else {
          <ul class="item-list">
            @for (worker of workers(); track worker.worker_id) {
              <li class="item-row session-row">
                <div class="item-info">
                  <span class="item-title">{{ worker.worker_id }}</span>
                  <span class="item-sub">
                    <span class="item-meta">host={{ worker.hostname }}</span>
                    <span class="item-meta">pid={{ worker.pid }}</span>
                    <span class="item-meta">ttl={{ worker.ttl_seconds }}s</span>
                    <span class="item-meta">last={{ formatTimestamp(worker.last_seen_at) }}</span>
                  </span>
                </div>
              </li>
            }
          </ul>
        }
      }
    </section>
  `,
  styleUrl: './admin-queue-tab.component.css'
})
export class AdminQueueTabComponent implements OnInit {
  protected readonly admin = inject(AdminService);
  protected readonly queueIcon = faTowerBroadcast;
  protected readonly queueStatus = computed(() => this.admin.queueStatus());
  protected readonly workers = computed(() => this.queueStatus()?.workers ?? []);

  ngOnInit(): void {
    void this.admin.fetchQueueStatus();
  }

  protected refresh(): void {
    void this.admin.fetchQueueStatus();
  }

  protected formatTimestamp(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }
}
