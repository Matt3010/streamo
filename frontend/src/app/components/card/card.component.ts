import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IconComponent } from '../../ui/icon/icon.component';
import { PendingButtonDirective } from '../../ui/pending-button.directive';
import { getStatusButtonTitle, getStatusButtonIcon } from '../../utils/watchlist-status.util';
import type { CardItem } from '../../models';

const IMG_BASE = 'https://image.tmdb.org/t/p/w342';

@Component({
  selector: 'app-card',
  standalone: true,
  imports: [IconComponent, PendingButtonDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card"
             [class.card-upcoming]="item().isUpcoming === true"
             [class.card-draggable]="draggable()"
             [class.card-dragging]="dragging()"
             [attr.draggable]="draggable() ? 'true' : null"
             (click)="cardClick.emit(item())"
             (dragstart)="onDragStart($event)"
             (dragend)="onDragEnd()">
      @if (item().poster) {
        <img class="card-poster" [src]="posterUrl()" [alt]="item().title" loading="lazy">
      } @else {
        <div class="no-poster">
          <app-icon name="film"></app-icon>
        </div>
      }

      @if (showProgress() && progressPct() !== null) {
        <div class="card-progress"><span [style.width.%]="progressPct()"></span></div>
      }

      @if (hasActions()) {
        <div class="card-actions">
          @if (showWatchlistToggle()) {
            <button class="card-action card-watchlist"
                    [uiPending]="hasPendingAction()"
                    [class.active]="item().inWatchlist === true"
                    [title]="item().inWatchlist ? 'Rimuovi dalla lista' : 'Aggiungi alla lista'"
                    (click)="onWatchlistToggle($event)">
              <app-icon name="bookmark"></app-icon>
            </button>
          }
          @if (showFolderAction()) {
            <button class="card-action card-folder"
                    [uiPending]="hasPendingAction()"
                    [class.active]="!!item().folderName"
                    [title]="item().folderName ? 'Modifica folder' : 'Assegna folder'"
                    (click)="onFolderClick($event)">
              <app-icon name="folder"></app-icon>
            </button>
          }
          @if (canShowStatusToggle()) {
            <button class="card-action card-status"
                    [uiPending]="hasPendingAction()"
                    [class.done]="item().status === 'done'"
                    [class.in-progress]="item().status === 'in_progress'"
                    [title]="statusButtonTitle()"
                    (click)="onStatusToggle($event)">
              <app-icon [name]="statusButtonIcon()"></app-icon>
            </button>
          }
          @if (showRemove()) {
            <button class="card-action card-remove"
                    [uiPending]="hasPendingAction()"
                    [title]="removeTitle()" [attr.aria-label]="removeTitle()"
                    (click)="onRemove($event)">
              <app-icon name="trash"></app-icon>
            </button>
          }
        </div>
      }

      <div class="card-overlay">
        <h3 class="card-title">{{ item().title }}</h3>
        @if (episodeBadge() || item().year || item().rating) {
          <div class="card-meta">
            @if (episodeBadge()) { <span>{{ episodeBadge() }}</span> }
            @if (item().year) { <span>{{ item().year }}</span> }
            @if (item().rating) { <span class="card-rating">★ {{ item().rating }}</span> }
          </div>
        }
        @if (item().watchStatus) {
          <div class="card-watch-status">{{ item().watchStatus }}</div>
        }
        @if (item().nextReleaseText) {
          <div class="card-release-status">{{ item().nextReleaseText }}</div>
        }
      </div>
    </article>
  `,
  styleUrl: './card.component.css'
})
export class CardComponent {
  readonly item = input.required<CardItem>();
  readonly showProgress = input(false);
  readonly showRemove = input(false);
  readonly removeTitle = input('Rimuovi');
  readonly showStatusToggle = input(false);
  readonly showWatchlistToggle = input(false);
  readonly showFolderAction = input(false);
  readonly draggable = input(false);
  readonly dragging = input(false);

  readonly cardClick = output<CardItem>();
  readonly removeClick = output<CardItem>();
  readonly statusToggleClick = output<CardItem>();
  readonly watchlistToggleClick = output<CardItem>();
  readonly folderClick = output<CardItem>();
  readonly dragStarted = output<DragEvent>();
  readonly dragEnded = output<void>();

  protected readonly posterUrl = computed(() => {
    const p = this.item().poster;
    return p ? `${IMG_BASE}${p}` : '';
  });

  protected readonly progressPct = computed(() => {
    const it = this.item();
    if (typeof it.duration !== 'number' || typeof it.position !== 'number' || it.duration <= 0) return null;
    return Math.min(100, (it.position / it.duration) * 100);
  });

  protected readonly episodeBadge = computed(() => {
    const it = this.item();
    return it.media_type === 'tv' && it.season && it.episode ? `S${it.season} E${it.episode}` : '';
  });

  protected readonly canShowStatusToggle = computed(() => this.showStatusToggle() && this.item().isUpcoming !== true);
  protected readonly hasPendingAction = computed(() => !!this.item().pendingAction);
  protected readonly hasActions = computed(
    () => this.canShowStatusToggle() || this.showWatchlistToggle() || this.showRemove() || this.showFolderAction()
  );
  protected readonly statusButtonTitle = computed(() => getStatusButtonTitle(this.item().status));
  protected readonly statusButtonIcon = computed(() => getStatusButtonIcon(this.item().status));

  protected onRemove(e: MouseEvent): void {
    e.stopPropagation();
    this.removeClick.emit(this.item());
  }

  protected onStatusToggle(e: MouseEvent): void {
    e.stopPropagation();
    this.statusToggleClick.emit(this.item());
  }

  protected onWatchlistToggle(e: MouseEvent): void {
    e.stopPropagation();
    this.watchlistToggleClick.emit(this.item());
  }

  protected onFolderClick(e: MouseEvent): void {
    e.stopPropagation();
    this.folderClick.emit(this.item());
  }

  protected onDragStart(event: DragEvent): void {
    if (!this.draggable()) {
      event.preventDefault();
      return;
    }
    this.dragStarted.emit(event);
  }

  protected onDragEnd(): void {
    if (!this.draggable()) return;
    this.dragEnded.emit();
  }
}
