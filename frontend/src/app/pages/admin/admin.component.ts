import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { AdminService } from '../../services/admin.service';
import { UiModalComponent } from '../../ui/modal/modal.component';
import { IconComponent } from '../../components/icon/icon.component';
import { ToastService } from '../../services/toast.service';
import { NavigationSourceService } from '../../services/navigation-source.service';
import type { AdminTokenRow, PlaybackLogEntry, TransportLogEntry } from '../../models';

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
  selector: 'app-admin',
  standalone: true,
  imports: [UiModalComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div class="page-header-back">
        <button class="back-btn" (click)="back()">
          <app-icon name="chevron-left"></app-icon>
          <span>Indietro</span>
        </button>
      </div>
      <div class="page-header-row">
        <h2>Pannello Admin</h2>
      </div>
    </div>

    <div class="admin-content">
      <section class="admin-section">
        <div class="section-header">
          <h3>Token e Utenti</h3>
          <div class="section-actions">
            <input type="text" placeholder="Label (opzionale)" class="label-input"
                   [value]="newTokenLabel()" (input)="updateLabel($event)">
            <button class="action-btn" (click)="generateToken()">
              Genera Token
            </button>
          </div>
        </div>

        @if (admin.loading()) {
          <p class="loading">Caricamento...</p>
        } @else if (admin.tokens().length === 0) {
          <p class="empty">Nessun token presente</p>
        } @else {
          <ul class="item-list">
            @for (token of admin.tokens(); track token.token) {
              <li class="item-row" [class.revoked]="token.revoked_at !== null">
                <span class="token-status" [class.used]="token.used_at !== null" [class.revoked]="token.revoked_at !== null">
                  {{ getTokenStatus(token) }}
                </span>
                <div class="item-info">
                  <span class="item-title">
                    @if (token.used_by_email) {
                      {{ token.used_by_email }}
                    } @else {
                      <span class="muted">[non usato]</span>
                    }
                  </span>
                  <span class="item-sub">
                    @if (token.label) {
                      <span class="item-meta">{{ token.label }}</span>
                    }
                    <span class="item-meta">Creato: {{ formatDate(token.created_at) }}</span>
                  </span>
                </div>
                <div class="row-actions">
                  @if (token.revoked_at === null) {
                    <button class="row-action" title="Copia token" (click)="copyToken(token.token)">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                      </svg>
                    </button>
                    <button class="row-action danger" title="Revoca" (click)="confirmRevoke(token)">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="15" y1="9" x2="9" y2="15"></line>
                        <line x1="9" y1="9" x2="15" y2="15"></line>
                      </svg>
                    </button>
                  } @else {
                    <span class="revoked-label">Revocato</span>
                  }
                </div>
              </li>
            }
          </ul>
        }
      </section>

      <section class="admin-section">
        <div class="section-header">
          <h3>Sessioni Live</h3>
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
                    <span class="item-meta">{{ formatTime(session.position) }} / {{ formatTime(session.duration) }}</span>
                    <span class="item-meta">{{ timeAgo(session.updated_at) }}</span>
                  </span>
                </div>
              </li>
            }
          </ul>
        }
      </section>

      <section class="admin-section">
        <div class="section-header">
          <div class="section-heading">
            <h3>Playback Logs</h3>
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
                <li class="log-row">
                  <span class="log-time">{{ formatPlaybackLogTime(log.ts) }}</span>
                  <code class="log-message">{{ log.message }}</code>
                </li>
              }
            </ul>
          </div>
        }
      </section>

      <section class="admin-section">
        <div class="section-header">
          <div class="section-heading">
            <h3>Transport Logs</h3>
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
                <li class="log-row">
                  <span class="log-time">{{ log.ts }}</span>
                  <div class="log-stack">
                    <code class="log-message">{{ transportLogSummary(log) }}</code>
                    <code class="log-detail">{{ log.request_uri }}</code>
                  </div>
                </li>
              }
            </ul>
          </div>
        }
      </section>
    </div>

    <ui-modal [(open)]="revokeModalOpen" title="Conferma Revoca" size="sm">
      <div class="revoke-modal-content">
        <p>
          @if (tokenToRevoke()?.used_by_email) {
            Sei sicuro di voler revocare l'accesso a <strong>{{ tokenToRevoke()?.used_by_email }}</strong>?
          } @else {
            Sei sicuro di voler revocare questo token?
          }
        </p>
        <p class="warning">L'utente verra disconnesso immediatamente.</p>
        <div class="modal-actions">
          <button class="cancel-btn" (click)="cancelRevoke()">Annulla</button>
          <button class="danger-btn" (click)="executeRevoke()">Revoca</button>
        </div>
      </div>
    </ui-modal>
  `,
  styleUrl: './admin.component.css'
})
export class AdminComponent implements OnInit, OnDestroy {
  protected readonly admin = inject(AdminService);
  private readonly toast = inject(ToastService);
  private readonly navSource = inject(NavigationSourceService);

  protected readonly newTokenLabel = signal('');
  protected readonly revokeModalOpen = signal(false);
  protected readonly tokenToRevoke = signal<AdminTokenRow | null>(null);
  protected readonly playbackLogsDesc = computed(() => [...this.admin.playbackLogs()].reverse());
  protected readonly transportLogsDesc = computed(() => [...this.admin.transportLogs()].reverse());

  ngOnInit(): void {
    void this.admin.fetchTokens();
    void this.admin.fetchSessions();
    void this.admin.fetchPlaybackLogs();
    void this.admin.fetchTransportLogs();
    this.admin.connectSessionsLive();
    this.admin.connectPlaybackLogsLive();
    this.admin.connectTransportLogsLive();
  }

  ngOnDestroy(): void {
    this.admin.disconnectSessionsLive();
    this.admin.disconnectPlaybackLogsLive();
    this.admin.disconnectTransportLogsLive();
  }

  protected back(): void {
    this.navSource.goBack('/');
  }

  protected updateLabel(ev: Event): void {
    const target = ev.target;
    if (target instanceof HTMLInputElement) {
      this.newTokenLabel.set(target.value);
    }
  }

  protected async generateToken(): Promise<void> {
    const label = this.newTokenLabel().trim() || undefined;
    const result = await this.admin.createToken(label);
    if (result) {
      this.newTokenLabel.set('');
      this.toast.show('Token generato');
      await navigator.clipboard.writeText(result.token);
      this.toast.show('Token copiato negli appunti');
    } else {
      this.toast.show('Errore nella generazione del token');
    }
  }

  protected async copyToken(token: string): Promise<void> {
    await navigator.clipboard.writeText(token);
    this.toast.show('Token copiato');
  }

  protected confirmRevoke(token: AdminTokenRow): void {
    this.tokenToRevoke.set(token);
    this.revokeModalOpen.set(true);
  }

  protected cancelRevoke(): void {
    this.revokeModalOpen.set(false);
    this.tokenToRevoke.set(null);
  }

  protected async executeRevoke(): Promise<void> {
    const token = this.tokenToRevoke();
    if (!token) return;

    const result = await this.admin.revokeToken(token.token);
    this.revokeModalOpen.set(false);
    this.tokenToRevoke.set(null);

    if (result.ok) {
      this.toast.show(result.was_used ? 'Accesso revocato' : 'Token revocato');
    } else {
      this.toast.show('Errore nella revoca');
    }
  }

  protected getTokenStatus(token: AdminTokenRow): string {
    if (token.revoked_at !== null) return 'REVOCATO';
    if (token.used_at !== null) return 'ATTIVO';
    return 'DISPONIBILE';
  }

  protected formatDate(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleDateString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  protected formatTime(seconds: number): string {
    return formatTime(seconds);
  }

  protected timeAgo(timestamp: number): string {
    return timeAgo(timestamp);
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

  protected trackTransportLog(_index: number, log: TransportLogEntry): string {
    return `${log.ts}:${log.kind}:${log.request_uri}:${log.status}:${log.upstream_status}`;
  }

  protected transportLogSummary(log: TransportLogEntry): string {
    return `${log.kind.toUpperCase()} ${log.status} upstream=${log.upstream_status} host=${log.upstream_host} rt=${log.request_time}s urt=${log.upstream_response_time}s`;
  }
}
