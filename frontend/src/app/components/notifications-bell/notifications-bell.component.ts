import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { IconComponent } from '../../ui/icon/icon.component';
import { UiPopoverComponent } from '../../ui/popover/popover.component';
import { UiButtonDirective } from '../../ui/ui-button.directive';
import { NotificationsService } from '../../services/notifications.service';
import type { NotificationItem, NotificationType } from '../../models';

@Component({
  selector: 'app-notifications-bell',
  standalone: true,
  imports: [IconComponent, UiPopoverComponent, UiButtonDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button #trigger
            uiButton="panel-pill"
            type="button"
            class="bell-trigger"
            [attr.aria-expanded]="open()"
            [attr.aria-label]="ariaLabel()"
            (click)="toggle()">
      <app-icon name="bell"></app-icon>
      @if (notifications.hasUnread()) {
        <span class="bell-badge" aria-hidden="true">{{ badgeText() }}</span>
      }
    </button>

    <ui-popover [(open)]="open"
                [anchor]="triggerEl()?.nativeElement ?? null"
                [width]="360"
                [preferredHeight]="320"
                title="Notifiche"
                [secondary]="secondaryLabel()"
                (closed)="onClose()">
      <div class="bell-list">
        @if (items().length === 0) {
          <div class="bell-empty">Nessuna notifica</div>
        }
        @for (n of items(); track n.id) {
          <div class="bell-item" [class.unread]="n.read_at === null">
            <button type="button" class="bell-main" (click)="onItemClick(n)">
              @if (n.poster) {
                <img class="bell-thumb" [src]="n.poster" alt="">
              } @else {
                <span class="bell-thumb bell-thumb-empty" aria-hidden="true"></span>
              }
              <span class="bell-copy">
                <span class="bell-title">{{ n.title ?? defaultTitleFor(n.type) }}</span>
                <span class="bell-body">{{ bodyFor(n) }}</span>
                <span class="bell-time">{{ formatRelative(n.created_at) }}</span>
              </span>
            </button>
            <button type="button"
                    class="bell-remove"
                    aria-label="Rimuovi notifica"
                    (click)="onRemove($event, n.id)">
              <app-icon name="close"></app-icon>
            </button>
          </div>
        }
      </div>

      @if (items().length > 0 && notifications.hasUnread()) {
        <div class="bell-footer">
          <button uiButton="ghost" uiButtonSize="dense" type="button" (click)="onMarkAll()">
            Segna tutte come lette
          </button>
        </div>
      }
    </ui-popover>
  `,
  styleUrl: './notifications-bell.component.css'
})
export class NotificationsBellComponent {
  protected readonly notifications = inject(NotificationsService);
  private readonly router = inject(Router);

  protected readonly open = signal(false);
  protected readonly triggerEl = viewChild<ElementRef<HTMLButtonElement>>('trigger');

  protected readonly items = computed(() => this.notifications.items().slice(0, 20));
  protected readonly badgeText = computed(() => {
    const n = this.notifications.unreadCount();
    if (n <= 0) return '';
    return n > 9 ? '9+' : String(n);
  });
  protected readonly secondaryLabel = computed(() => {
    const n = this.notifications.unreadCount();
    if (n <= 0) return 'Sei aggiornato';
    return n === 1 ? '1 da leggere' : `${n} da leggere`;
  });
  protected readonly ariaLabel = computed(() => {
    const n = this.notifications.unreadCount();
    return n > 0 ? `Notifiche, ${n} non lette` : 'Notifiche';
  });

  protected toggle(): void {
    this.open.update((o) => !o);
  }

  protected onClose(): void {
    this.open.set(false);
  }

  protected async onItemClick(n: NotificationItem): Promise<void> {
    this.open.set(false);
    if (n.read_at === null) void this.notifications.markRead(n.id);
    await this.router.navigate(['/watch', n.media_type, n.tmdb_id]);
  }

  protected onRemove(event: MouseEvent, id: number): void {
    event.stopPropagation();
    void this.notifications.remove(id);
  }

  protected onMarkAll(): void {
    void this.notifications.markAllRead();
  }

  protected defaultTitleFor(type: NotificationType): string {
    switch (type) {
      case 'new_episode': return 'Nuovo episodio';
      case 'new_season': return 'Nuova stagione';
      case 'resume_reminder': return 'Riprendi a guardare';
    }
  }

  protected bodyFor(n: NotificationItem): string {
    const { season, episode, aired_delta } = n.payload ?? {};
    switch (n.type) {
      case 'new_season':
        return season ? `Nuova stagione (S${season})` : 'Nuova stagione disponibile';
      case 'new_episode':
        if (aired_delta && aired_delta > 1) return `${aired_delta} nuovi episodi`;
        if (season && episode) return `S${season} E${episode}`;
        return 'Nuovo episodio disponibile';
      case 'resume_reminder':
        if (season && episode) return `Riprendi da S${season} E${episode}`;
        return 'Hai un titolo da finire';
    }
  }

  protected formatRelative(epochSeconds: number): string {
    const diff = Math.max(0, Math.floor(Date.now() / 1000) - epochSeconds);
    if (diff < 60) return 'adesso';
    if (diff < 3600) return `${Math.floor(diff / 60)} min fa`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} h fa`;
    return `${Math.floor(diff / 86400)} g fa`;
  }
}
