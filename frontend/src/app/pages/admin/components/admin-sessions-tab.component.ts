import { ChangeDetectionStrategy, Component, inject, OnDestroy, OnInit } from '@angular/core';
import { faSatelliteDish } from '@fortawesome/free-solid-svg-icons';
import { SectionHeaderComponent } from '../../../ui/section-header/section-header.component';
import { AdminService } from '../../../services/admin.service';

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function timeAgo(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  if (diff < 60) return `${diff}s fa`;
  return `${Math.floor(diff / 60)}m fa`;
}

@Component({
  selector: 'app-admin-sessions-tab',
  standalone: true,
  imports: [SectionHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="admin-section">
      <div class="section-header">
        <app-section-header title="Sessioni Live" [icon]="sessionsIcon" />
        <span class="live-pill" [class.connected]="admin.sessionsLiveConnected()">
          <span class="live-pill-dot" aria-hidden="true"></span>
          <span>{{ admin.sessionsLiveConnected() ? 'Canale live attivo' : 'Canale live non connesso' }}</span>
        </span>
      </div>

      @if (admin.sessions().length === 0) {
        <p class="empty">Nessuno sta guardando ora</p>
      } @else {
        <ul class="item-list">
          @for (session of admin.sessions(); track session.user_id + '-' + session.tmdb_id + '-' + session.season + '-' + session.episode) {
            <li class="item-row session-row">
              <div class="item-info">
                <span class="item-title">{{ session.email }}</span>
                <span class="item-sub">
                  <span class="item-meta">{{ session.title || 'Sconosciuto' }}</span>
                  @if (session.media_type === 'tv') {
                    <span class="item-meta">S{{ session.season }}E{{ session.episode }}</span>
                  }
                  <span class="item-meta">{{ formatPlaybackTime(session.position) }} / {{ formatPlaybackTime(session.duration) }}</span>
                  <span class="item-meta">{{ formatTimeAgo(session.updated_at) }}</span>
                </span>
              </div>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styleUrl: './admin-sessions-tab.component.css'
})
export class AdminSessionsTabComponent implements OnInit, OnDestroy {
  protected readonly admin = inject(AdminService);
  protected readonly sessionsIcon = faSatelliteDish;

  ngOnInit(): void {
    void this.admin.fetchSessions();
    this.admin.connectSessionsLive();
  }

  ngOnDestroy(): void {
    this.admin.disconnectSessionsLive();
  }

  protected formatPlaybackTime(seconds: number): string {
    return formatTime(seconds);
  }

  protected formatTimeAgo(timestamp: number): string {
    return timeAgo(timestamp);
  }
}
