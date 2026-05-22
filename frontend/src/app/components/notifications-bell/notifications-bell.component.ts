import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { IconComponent } from '../../ui/icon/icon.component';
import { UiPopoverComponent } from '../../ui/popover/popover.component';
import { UiButtonDirective } from '../../ui/ui-button.directive';
import { NotificationsService } from '../../services/notifications.service';
import type { NotificationItem } from '../../models';
import {
  formatNotificationBody,
  formatNotificationTitle,
  notificationTargetPath
} from '../../../../../shared/notification-format';

@Component({
  selector: 'app-notifications-bell',
  standalone: true,
  imports: [IconComponent, UiPopoverComponent, UiButtonDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button #trigger
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
      <div class="bell-body">
        <div class="bell-list">
          @if (items().length === 0) {
            <div class="bell-empty">Nessuna notifica</div>
          }
          @for (n of items(); track n.id) {
            <div class="bell-item" [class.unread]="n.read_at === null">
              <button type="button" class="bell-main" (click)="onItemClick(n)">
                @if (posterUrl(n); as src) {
                  <img class="bell-thumb" [src]="src" alt="">
                } @else {
                  <span class="bell-thumb bell-thumb-empty" aria-hidden="true"></span>
                }
                <span class="bell-copy">
                  <span class="bell-title">{{ titleFor(n) }}</span>
                  <span class="bell-text">{{ bodyFor(n) }}</span>
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
      </div>
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
    await this.router.navigateByUrl(notificationTargetPath(n));
  }

  protected onRemove(event: MouseEvent, id: number): void {
    event.stopPropagation();
    void this.notifications.remove(id);
  }

  protected onMarkAll(): void {
    void this.notifications.markAllRead();
  }

  protected titleFor(n: NotificationItem): string {
    return formatNotificationTitle(n);
  }

  protected bodyFor(n: NotificationItem): string {
    return formatNotificationBody(n);
  }

  protected posterUrl(n: NotificationItem): string | null {
    if (!n.poster) return null;
    // Backend stores TMDB's bare poster_path (e.g. "/abc.jpg"). Prepend
    // the image CDN base — w92 is the smallest size, plenty for the bell
    // thumbnail (40×56 css).
    return n.poster.startsWith('http')
      ? n.poster
      : `https://image.tmdb.org/t/p/w92${n.poster}`;
  }

  protected formatRelative(epochSeconds: number): string {
    const diff = Math.max(0, Math.floor(Date.now() / 1000) - epochSeconds);
    if (diff < 60) return 'adesso';
    if (diff < 3600) return `${Math.floor(diff / 60)} min fa`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} h fa`;
    return `${Math.floor(diff / 86400)} g fa`;
  }
}
