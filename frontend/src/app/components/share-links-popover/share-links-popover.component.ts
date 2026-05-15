import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
  output,
  signal
} from '@angular/core';
import { IconComponent } from '../../ui/icon/icon.component';
import { UiButtonDirective } from '../../ui/ui-button.directive';
import { UiInputDirective } from '../../ui/ui-input.directive';
import { UiPopoverComponent } from '../../ui/popover/popover.component';
import { PendingButtonDirective } from '../../ui/pending-button.directive';
import { ShareLinksService } from '../../services/share-links.service';
import { ToastService } from '../../services/toast.service';
import type { ShareLink } from '../../../../../shared/types';

/* Popover that manages a user's share links: list existing, create
 * new (with optional label), copy URL to clipboard, suspend/resume,
 * delete. Mirrors the folder popover's UI patterns (dense inputs,
 * dense buttons, header with icon badge) so the two related
 * "manage tokens" surfaces feel like the same family. */
@Component({
  selector: 'app-share-links-popover',
  standalone: true,
  imports: [
    IconComponent,
    UiButtonDirective,
    UiInputDirective,
    UiPopoverComponent,
    PendingButtonDirective
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './share-links-popover.component.css',
  template: `
    <ui-popover [(open)]="open"
                [anchor]="anchor()"
                [width]="460"
                [preferredHeight]="200"
                icon="share"
                title="Condividi la mia lista"
                [secondary]="links().length === 0
                  ? 'Genera un link in sola lettura per condividere la tua watchlist'
                  : links().length + ' link attivi o sospesi'"
                (closed)="onClosed()">
      <div class="share-popover-body">
        <div class="share-create-row">
          <input uiInput="dense"
                 type="text"
                 maxlength="60"
                 [value]="draftLabel()"
                 placeholder="Etichetta (opzionale)"
                 (input)="onDraftInput($event)">
          <button uiButton="primary" uiButtonSize="dense" type="button"
                  [uiPending]="creating()"
                  (click)="create()">
            <app-icon name="share"></app-icon>
            <span>Nuovo link</span>
          </button>
        </div>

        @if (loading()) {
          <p class="share-status">Caricamento…</p>
        } @else if (links().length === 0) {
          <p class="share-status">Nessun link condiviso. Creane uno per generare un URL pubblico.</p>
        } @else {
          <ul class="share-list">
            @for (link of links(); track link.id) {
              <li class="share-row" [class.is-suspended]="link.status === 'suspended'">
                <div class="share-row-copy">
                  <span class="share-row-label">{{ link.label || 'Senza etichetta' }}</span>
                  <span class="share-row-url">{{ urlForToken(link.token) }}</span>
                  @if (link.status === 'suspended') {
                    <span class="share-row-badge">Sospeso</span>
                  }
                </div>
                <div class="share-row-actions">
                  <button uiButton="icon-outline" uiButtonSize="action" type="button"
                          title="Copia link"
                          (click)="copyLink(link.token)">
                    <app-icon name="copy"></app-icon>
                  </button>
                  @if (link.status === 'active') {
                    <button uiButton="icon-outline" uiButtonSize="action" type="button"
                            uiButtonHover="neutral"
                            [uiPending]="pendingId() === link.id"
                            title="Sospendi"
                            (click)="toggleStatus(link)">
                      <app-icon name="pause"></app-icon>
                    </button>
                  } @else {
                    <button uiButton="icon-outline" uiButtonSize="action" type="button"
                            uiButtonHover="success"
                            [uiPending]="pendingId() === link.id"
                            title="Riattiva"
                            (click)="toggleStatus(link)">
                      <app-icon name="play"></app-icon>
                    </button>
                  }
                  <button uiButton="icon-outline" uiButtonSize="action" type="button"
                          uiButtonHover="danger"
                          [uiPending]="pendingId() === link.id"
                          title="Elimina"
                          (click)="remove(link)">
                    <app-icon name="trash"></app-icon>
                  </button>
                </div>
              </li>
            }
          </ul>
        }
      </div>
    </ui-popover>
  `
})
export class ShareLinksPopoverComponent {
  private readonly service = inject(ShareLinksService);
  private readonly toast = inject(ToastService);

  readonly open = model.required<boolean>();
  readonly anchor = input<HTMLElement | null>(null);
  readonly closed = output<void>();

  protected readonly links = signal<ShareLink[]>([]);
  protected readonly loading = signal(false);
  protected readonly creating = signal(false);
  protected readonly pendingId = signal<number | null>(null);
  protected readonly draftLabel = signal('');

  protected readonly origin = computed(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.protocol}//${window.location.host}`;
  });

  /* Manual lifecycle hook driven by the parent toggling open. */
  protected onClosed(): void {
    this.closed.emit();
  }

  protected urlForToken(token: string): string {
    return `${this.origin()}/shared/${token}`;
  }

  protected onDraftInput(ev: Event): void {
    const target = ev.target;
    if (target instanceof HTMLInputElement) this.draftLabel.set(target.value);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    const links = await this.service.list();
    this.links.set(links);
    this.loading.set(false);
  }

  protected async create(): Promise<void> {
    if (this.creating()) return;
    this.creating.set(true);
    const label = this.draftLabel().trim() || null;
    const created = await this.service.create(label);
    this.creating.set(false);
    if (!created) {
      this.toast.show('Errore nella creazione del link');
      return;
    }
    this.links.update((current) => [created, ...current]);
    this.draftLabel.set('');
    void this.copyLink(created.token);
  }

  protected async toggleStatus(link: ShareLink): Promise<void> {
    if (this.pendingId() !== null) return;
    this.pendingId.set(link.id);
    const nextStatus = link.status === 'active' ? 'suspended' : 'active';
    const updated = await this.service.update(link.id, { status: nextStatus });
    this.pendingId.set(null);
    if (!updated) {
      this.toast.show('Errore nell’aggiornamento del link');
      return;
    }
    this.links.update((current) => current.map((l) => l.id === updated.id ? updated : l));
    this.toast.show(nextStatus === 'suspended' ? 'Link sospeso' : 'Link riattivato');
  }

  protected async remove(link: ShareLink): Promise<void> {
    if (this.pendingId() !== null) return;
    this.pendingId.set(link.id);
    const ok = await this.service.remove(link.id);
    this.pendingId.set(null);
    if (!ok) {
      this.toast.show('Errore nell’eliminazione');
      return;
    }
    this.links.update((current) => current.filter((l) => l.id !== link.id));
    this.toast.show('Link eliminato');
  }

  protected async copyLink(token: string): Promise<void> {
    const url = this.urlForToken(token);
    try {
      await navigator.clipboard.writeText(url);
      this.toast.show('Link copiato negli appunti');
    } catch {
      this.toast.show('Copia non riuscita — il link è nella popover');
    }
  }
}
