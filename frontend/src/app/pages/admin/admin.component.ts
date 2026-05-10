import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { AdminService } from '../../services/admin.service';
import { UiModalComponent } from '../../ui/modal/modal.component';
import { IconComponent } from '../../components/icon/icon.component';
import { ToastService } from '../../services/toast.service';
import { NavigationSourceService } from '../../services/navigation-source.service';
import type { AdminTokenRow, PlaybackLogEntry, TransportLogEntry } from '../../models';

type TokenAction = 'revoke' | 'reactivate' | 'delete';

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
                    @if (!canManageToken(token)) {
                      <span class="item-meta protected-meta">Token protetto</span>
                    }
                  </span>
                </div>
                <div class="row-actions">
                  @if (token.revoked_at === null && canManageToken(token)) {
                    <button class="row-action" title="Copia token" (click)="copyToken(token.token)">
                      <app-icon name="copy"></app-icon>
                    </button>
                    <button class="row-action danger" title="Revoca" (click)="confirmRevoke(token)">
                      <app-icon name="close"></app-icon>
                    </button>
                    <button class="row-action danger" title="Elimina definitivamente" (click)="confirmDelete(token)">
                      <app-icon name="trash"></app-icon>
                    </button>
                  } @else if (token.revoked_at !== null && canManageToken(token)) {
                    <button class="row-action" title="Riattiva" (click)="confirmReactivate(token)">
                      <app-icon name="rotate-left"></app-icon>
                    </button>
                    <button class="row-action danger" title="Elimina definitivamente" (click)="confirmDelete(token)">
                      <app-icon name="trash"></app-icon>
                    </button>
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
    </div>

    <ui-modal [(open)]="revokeModalOpen" [title]="confirmModalTitle()" size="sm">
      <div class="revoke-modal-content">
        <p>
          @if (confirmAction() === 'revoke' && tokenToRevoke()?.used_by_email) {
            Sei sicuro di voler revocare l'accesso a <strong>{{ tokenToRevoke()?.used_by_email }}</strong>?
          } @else if (confirmAction() === 'revoke') {
            Sei sicuro di voler revocare questo token?
          } @else if (confirmAction() === 'reactivate' && tokenToRevoke()?.used_by_email) {
            Vuoi riattivare l'accesso per <strong>{{ tokenToRevoke()?.used_by_email }}</strong>?
          } @else if (confirmAction() === 'reactivate') {
            Vuoi riattivare questo token?
          } @else if (tokenToRevoke()?.used_by_email) {
            Vuoi eliminare definitivamente il token associato a <strong>{{ tokenToRevoke()?.used_by_email }}</strong>?
          } @else {
            Vuoi eliminare definitivamente questo token?
          }
        </p>
        <p class="warning">{{ confirmModalWarning() }}</p>
        <div class="modal-actions">
          <button class="cancel-btn" (click)="cancelRevoke()">Annulla</button>
          <button class="danger-btn" [class.neutral-btn]="confirmAction() === 'reactivate'" (click)="executeTokenAction()">
            {{ confirmModalActionLabel() }}
          </button>
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
  protected readonly confirmAction = signal<TokenAction>('revoke');
  protected readonly playbackLogsDesc = computed(() => [...this.admin.playbackLogs()].reverse());
  protected readonly transportLogsDesc = computed(() => [...this.admin.transportLogs()].reverse());
  protected readonly confirmModalTitle = computed(() =>
    this.confirmAction() === 'revoke'
      ? 'Conferma Revoca'
      : this.confirmAction() === 'reactivate'
        ? 'Conferma Riattivazione'
        : 'Conferma Eliminazione'
  );
  protected readonly confirmModalActionLabel = computed(() =>
    this.confirmAction() === 'revoke'
      ? 'Revoca'
      : this.confirmAction() === 'reactivate'
        ? 'Riattiva'
        : 'Elimina'
  );
  protected readonly confirmModalWarning = computed(() =>
    this.confirmAction() === 'delete'
      ? 'Questa operazione elimina il token in modo definitivo.'
      : this.confirmAction() === 'reactivate'
        ? 'L\'utente potra usare di nuovo l\'accesso associato a questo token.'
        : 'L\'utente verra disconnesso immediatamente.'
  );

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
    this.confirmAction.set('revoke');
    this.revokeModalOpen.set(true);
  }

  protected confirmReactivate(token: AdminTokenRow): void {
    this.tokenToRevoke.set(token);
    this.confirmAction.set('reactivate');
    this.revokeModalOpen.set(true);
  }

  protected confirmDelete(token: AdminTokenRow): void {
    this.tokenToRevoke.set(token);
    this.confirmAction.set('delete');
    this.revokeModalOpen.set(true);
  }

  protected cancelRevoke(): void {
    this.revokeModalOpen.set(false);
    this.tokenToRevoke.set(null);
    this.confirmAction.set('revoke');
  }

  protected async executeTokenAction(): Promise<void> {
    const token = this.tokenToRevoke();
    if (!token) return;

    const action = this.confirmAction();
    const result = action === 'revoke'
      ? await this.admin.revokeToken(token.token)
      : action === 'reactivate'
        ? await this.admin.reactivateToken(token.token)
        : await this.admin.deleteTokenPermanently(token.token);
    this.revokeModalOpen.set(false);
    this.tokenToRevoke.set(null);
    this.confirmAction.set('revoke');

    if (result.ok) {
      if (action === 'revoke') {
        this.toast.show(result.was_used ? 'Accesso revocato' : 'Token revocato');
      } else if (action === 'reactivate') {
        this.toast.show(result.was_used ? 'Accesso riattivato' : 'Token riattivato');
      } else {
        this.toast.show(result.was_used ? 'Token eliminato e accesso revocato' : 'Token eliminato definitivamente');
      }
    } else {
      this.toast.show(
        action === 'revoke'
          ? 'Errore nella revoca'
          : action === 'reactivate'
            ? 'Errore nella riattivazione'
            : 'Errore nell\'eliminazione'
      );
    }
  }

  protected getTokenStatus(token: AdminTokenRow): string {
    if (token.revoked_at !== null) return 'REVOCATO';
    if (token.used_at !== null) return 'ATTIVO';
    return 'DISPONIBILE';
  }

  protected canManageToken(token: AdminTokenRow): boolean {
    return token.can_manage !== false;
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

  protected playbackLogTone(log: PlaybackLogEntry): 'ok' | 'info' | 'warn' | 'error' | 'cancelled' {
    const message = log.message.toLowerCase();
    if (message.includes(' status=499')) {
      return 'cancelled';
    }
    if (message.includes('fetch-error') || message.includes('write-error') || message.includes('read-error') || message.includes(' status=5')) {
      return 'error';
    }
    if (message.includes(' status=4')) {
      return 'warn';
    }
    if (message.includes('status=200') || message.includes(' playlist=yes') || message.includes(' master ') || message.includes(' media ')) {
      return 'ok';
    }
    return 'info';
  }

  protected playbackLogLabel(log: PlaybackLogEntry): string {
    const tone = this.playbackLogTone(log);
    return tone === 'ok'
      ? 'OK'
      : tone === 'warn'
        ? 'WARN'
        : tone === 'error'
          ? 'ERR'
          : tone === 'cancelled'
            ? 'CANCELLED'
            : 'INFO';
  }

  protected transportLogTone(log: TransportLogEntry): 'ok' | 'info' | 'warn' | 'error' | 'cancelled' {
    if (log.status === 499) {
      return 'cancelled';
    }
    if (log.status >= 500) {
      return 'error';
    }
    if (log.status >= 400) {
      return 'warn';
    }
    if (log.upstream_status.includes('500') || log.upstream_status.includes('502') || log.upstream_status.includes('503') || log.upstream_status.includes('504')) {
      return 'error';
    }
    if (log.upstream_status.includes('404') || log.upstream_status.includes('401') || log.upstream_status.includes('403')) {
      return 'warn';
    }
    if (log.status >= 200 && log.status < 400) {
      return 'ok';
    }
    return 'info';
  }

  protected transportLogLabel(log: TransportLogEntry): string {
    const tone = this.transportLogTone(log);
    return tone === 'ok'
      ? 'OK'
      : tone === 'warn'
        ? 'WARN'
        : tone === 'error'
          ? 'ERR'
          : tone === 'cancelled'
            ? 'CANCELLED'
            : 'INFO';
  }
}
