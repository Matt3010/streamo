import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from '../../ui/icon/icon.component';
import { PendingButtonDirective } from '../../ui/pending-button.directive';
import { UiButtonDirective } from '../../ui/ui-button.directive';
import { getStatusButtonIcon, getStatusButtonTitle } from '../../utils/watchlist-status.util';
import type { CardItem } from '../../models';
import type { UserListType } from './user-list-view.component';

export interface FolderClickEvent {
  item: CardItem;
  event: MouseEvent;
}

/* Renders the trailing button cluster of a list-view row. Lives next to
 * <app-list-item-info> inside an .item-row, so the host uses display:
 * contents to stay transparent to the flex layout. Each button stops the
 * click from bubbling to the row's own click handler before emitting. */
@Component({
  selector: 'app-list-row-actions',
  standalone: true,
  imports: [IconComponent, UiButtonDirective, PendingButtonDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [':host { display: contents; }'],
  template: `
    @if (kind() === 'watchlist' && !item().isUpcoming) {
      <button uiButton="icon-outline" uiButtonSize="action" type="button" uiButtonHover="success"
              [uiPending]="!!item().pendingAction"
              [uiButtonTone]="statusTone()"
              [title]="statusTitle()"
              (click)="statusToggle.emit(item()); $event.stopPropagation()">
        <app-icon [name]="statusIcon()"></app-icon>
      </button>
    }
    @if (kind() === 'watchlist' && folderEnabled()) {
      <button uiButton="icon-outline" uiButtonSize="action" type="button" uiButtonHover="neutral"
              [uiPending]="!!item().pendingAction"
              [uiButtonTone]="item().folderName ? 'neutral' : 'default'"
              [title]="item().folderName ? 'Modifica folder' : 'Assegna folder'"
              (click)="folderClick.emit({ item: item(), event: $event }); $event.stopPropagation()">
        <app-icon name="folder"></app-icon>
      </button>
    }
    @if (kind() === 'history' && isLoggedIn()) {
      <button uiButton="icon-outline" uiButtonSize="action" type="button" uiButtonHover="accent"
              [uiPending]="!!item().pendingAction"
              [uiButtonTone]="item().inWatchlist === true ? 'accent' : 'default'"
              [title]="item().inWatchlist ? 'Rimuovi dalla lista' : 'Aggiungi alla lista'"
              (click)="watchlistToggle.emit(item()); $event.stopPropagation()">
        <app-icon name="bookmark"></app-icon>
      </button>
    }
    <button uiButton="icon-outline" uiButtonSize="action" type="button" uiButtonHover="accent"
            [uiPending]="!!item().pendingAction"
            [title]="removeTitle()"
            (click)="removeClick.emit(item()); $event.stopPropagation()">
      <app-icon name="trash"></app-icon>
    </button>
  `
})
export class ListRowActionsComponent {
  readonly item = input.required<CardItem>();
  readonly kind = input.required<UserListType>();
  readonly folderEnabled = input(false);
  readonly isLoggedIn = input(false);

  readonly statusToggle = output<CardItem>();
  readonly folderClick = output<FolderClickEvent>();
  readonly watchlistToggle = output<CardItem>();
  readonly removeClick = output<CardItem>();

  protected statusTitle(): string {
    return getStatusButtonTitle(this.item().status);
  }

  protected statusIcon() {
    return getStatusButtonIcon(this.item().status);
  }

  protected statusTone(): 'success' | 'info' | 'default' {
    const status = this.item().status;
    if (status === 'done') return 'success';
    if (status === 'in_progress') return 'info';
    return 'default';
  }

  protected removeTitle(): string {
    return this.kind() === 'watchlist' ? 'Rimuovi dalla lista' : 'Rimuovi dalla cronologia';
  }
}
