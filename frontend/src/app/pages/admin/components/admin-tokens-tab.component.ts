import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { faTicket } from '@fortawesome/free-solid-svg-icons';
import { UiModalComponent } from '../../../ui/modal/modal.component';
import { IconComponent } from '../../../ui/icon/icon.component';
import { PendingButtonDirective } from '../../../ui/pending-button.directive';
import { SectionHeaderComponent } from '../../../ui/section-header/section-header.component';
import { AdminService } from '../../../services/admin.service';
import { ToastService } from '../../../services/toast.service';
import { runWithPending } from '../../../utils/pending.util';
import type { AdminTokenRow } from '../../../models';

type TokenAction = 'revoke' | 'reactivate' | 'delete';

@Component({
  selector: 'app-admin-tokens-tab',
  standalone: true,
  imports: [UiModalComponent, IconComponent, PendingButtonDirective, SectionHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="admin-section">
      <div class="section-header">
        <app-section-header title="Token e Utenti" [icon]="tokensIcon" />
        <div class="section-actions">
          <input type="text" placeholder="Label (opzionale)" class="label-input"
                 [value]="newTokenLabel()" (input)="updateLabel($event)">
          <button class="action-btn" [uiPending]="generateTokenPending()" (click)="generateToken()">
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
          <button class="danger-btn" [class.neutral-btn]="confirmAction() === 'reactivate'" [uiPending]="tokenActionPending()" (click)="executeTokenAction()">
            {{ confirmModalActionLabel() }}
          </button>
        </div>
      </div>
    </ui-modal>
  `,
  styleUrl: './admin-tokens-tab.component.css'
})
export class AdminTokensTabComponent implements OnInit {
  protected readonly admin = inject(AdminService);
  private readonly toast = inject(ToastService);
  protected readonly tokensIcon = faTicket;

  protected readonly newTokenLabel = signal('');
  protected readonly revokeModalOpen = signal(false);
  protected readonly generateTokenPending = signal(false);
  protected readonly tokenActionPending = signal(false);
  protected readonly tokenToRevoke = signal<AdminTokenRow | null>(null);
  protected readonly confirmAction = signal<TokenAction>('revoke');
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
  }

  protected updateLabel(ev: Event): void {
    const target = ev.target;
    if (target instanceof HTMLInputElement) {
      this.newTokenLabel.set(target.value);
    }
  }

  protected async generateToken(): Promise<void> {
    await runWithPending(this.generateTokenPending, async () => {
      const label = this.newTokenLabel().trim() || undefined;
      const result = await this.admin.createToken(label);
      if (!result) {
        this.toast.show('Errore nella generazione del token');
        return;
      }

      this.newTokenLabel.set('');
      this.toast.show('Token generato');
      await navigator.clipboard.writeText(result.token);
      this.toast.show('Token copiato negli appunti');
    });
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
    await runWithPending(this.tokenActionPending, async () => {
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
        return;
      }

      this.toast.show(
        action === 'revoke'
          ? 'Errore nella revoca'
          : action === 'reactivate'
            ? 'Errore nella riattivazione'
            : 'Errore nell\'eliminazione'
      );
    });
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
}
