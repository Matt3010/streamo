import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CardComponent } from '../../components/card/card.component';
import { PageHeaderComponent } from '../../ui/page-header/page-header.component';
import { IconComponent } from '../../ui/icon/icon.component';
import { ConfirmModalComponent } from '../../ui/confirm-modal/confirm-modal.component';
import { PendingButtonDirective } from '../../ui/pending-button.directive';
import { UiPopoverComponent } from '../../ui/popover/popover.component';
import { UiTabsComponent, UiTab } from '../../ui/tabs/tabs.component';
import { UiButtonDirective } from '../../ui/ui-button.directive';
import { UiInputDirective } from '../../ui/ui-input.directive';
import { ListItemInfoComponent } from './list-item-info.component';
import { ListRowActionsComponent } from './list-row-actions.component';
import { FolderCardComponent } from './folder-card.component';
import { FolderRowComponent } from './folder-row.component';
import { FolderPopoverController } from './folder-popover.controller';
import { DragDropController } from './drag-drop.controller';
import { ConfirmActionController } from './confirm-action.controller';
import {
  type ViewMode,
  type MediaFilter,
  type BackendMediaFilter,
  loadViewMode,
  persistViewMode,
  loadMediaFilter,
  persistMediaFilter,
  loadStatusFilter,
  persistStatusFilter,
  loadExpandedFolders,
  persistExpandedFolders
} from './user-list-storage.util';
import {
  buildHistorySections,
  isSameHistoryEntry
} from './history-sections.util';
import {
  buildDisplayEntries,
  cardKey,
  folderIdFromName
} from './folder-entries.util';
import { AuthService } from '../../services/auth.service';
import { TmdbService } from '../../services/tmdb.service';
import { WatchlistService } from '../../services/watchlist.service';
import { HistoryService } from '../../services/history.service';
import { ToastService } from '../../services/toast.service';
import { NavigationSourceService } from '../../services/navigation-source.service';
import { enrichLibraryCardsWithTmdb, historyToCardItem, watchlistToCardItem } from '../../utils/card-item.util';
import { applyWatchlistFlags, runCardMutation, setCardWatchlistFlag, toggleCardWatchlist } from '../../utils/card-watchlist.util';
import { getStatusTransition, getStatusToastMessage } from '../../utils/watchlist-status.util';
import type { CardItem, WatchlistListStatusFilter } from '../../models';

export type UserListType = 'watchlist' | 'history';
export type { ViewMode };

const STATUS_TABS: ReadonlyArray<UiTab<WatchlistListStatusFilter>> = [
  { value: 'todo', label: 'Da guardare' },
  { value: 'in_progress', label: 'In corso' },
  { value: 'done', label: 'Visto' },
  { value: 'unreleased', label: 'Non usciti' }
];

const MEDIA_TABS: ReadonlyArray<UiTab<MediaFilter>> = [
  { value: 'all', label: 'Tutti' },
  { value: 'tv', label: 'TV' },
  { value: 'movie', label: 'Film' }
];

interface WatchTimeCounter {
  value: string;
  unit: string;
}

@Component({
  selector: 'app-user-list-view',
  standalone: true,
  imports: [
    CardComponent,
    PageHeaderComponent,
    IconComponent,
    ConfirmModalComponent,
    PendingButtonDirective,
    UiPopoverComponent,
    UiTabsComponent,
    UiButtonDirective,
    UiInputDirective,
    ListItemInfoComponent,
    ListRowActionsComponent,
    FolderCardComponent,
    FolderRowComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header [title]="title()" (back)="back()">
      <div class="view-toggle" role="group" aria-label="Modalita visualizzazione">
        <button uiButton="toggle-icon" type="button" [attr.aria-pressed]="viewMode() === 'grid'"
                aria-label="Griglia" (click)="setViewMode('grid')">
          <app-icon name="grid"></app-icon>
        </button>
        <button uiButton="toggle-icon" type="button" [attr.aria-pressed]="viewMode() === 'list'"
                aria-label="Lista" (click)="setViewMode('list')">
          <app-icon name="list"></app-icon>
        </button>
      </div>
    </app-page-header>

    @if (kind() === 'history') {
      <section class="history-total-card" [attr.aria-label]="historyWatchTimeAriaLabel()">
        <p class="history-total-label">WatchTime totale account</p>
        @if (loading()) {
          <div class="history-total-skeleton" aria-hidden="true"></div>
        } @else {
          <div class="history-total-value">
            <span class="history-total-number">{{ historyWatchTimeCounter().value }}</span>
            <span class="history-total-unit">{{ historyWatchTimeCounter().unit }}</span>
          </div>
        }
      </section>
    }

    <div class="filter-bar">
      @if (kind() === 'watchlist') {
        <ui-tabs [tabs]="statusTabs" [(value)]="statusFilter" />
      }
      <ui-tabs [tabs]="mediaTabs" [(value)]="mediaFilter" />
    </div>

    @if (loading()) {
      <div class="loading"><div class="spinner"></div></div>
    } @else if (items().length === 0) {
      <div class="empty-state">
        <p class="empty-state-title">{{ emptyTitle() }}</p>
        <p class="empty-state-hint">{{ emptyHint() }}</p>
        <div class="empty-state-actions">
          @if (kind() === 'watchlist') {
            <button uiButton="primary" type="button" (click)="goToSearch()">Vai a cercare</button>
          } @else {
            <button uiButton="primary" type="button" (click)="goToBrowse()">Scopri film popolari</button>
          }
        </div>
      </div>
    } @else if (kind() === 'history') {
      <div class="history-sections">
        @for (section of historySections(); track section.key) {
          <section class="history-section">
            <div class="history-section-header">
              <div class="history-section-copy">
                <h3>{{ section.title }}</h3>
                @if (section.summary) {
                  <p>{{ section.summary }}</p>
                }
              </div>
            </div>

            @if (viewMode() === 'grid') {
              <div class="content-grid">
                @for (item of section.items; track cardKey(item)) {
                  <app-card
                    [item]="item"
                    [showRemove]="true"
                    removeTitle="Rimuovi dalla cronologia"
                    [showProgress]="true"
                    [showWatchlistToggle]="auth.isLoggedIn()"
                    (cardClick)="onCardClick($event)"
                    (watchlistToggleClick)="onWatchlistToggle($event)"
                    (removeClick)="onRemoveClick($event)" />
                }
              </div>
            } @else {
              <ul class="item-list history-item-list">
                @for (item of section.items; track cardKey(item)) {
                  <li class="item-row"
                      (click)="onCardClick(item)">
                    <app-list-item-info [item]="item" />
                    <app-list-row-actions
                      [item]="item"
                      [kind]="kind()"
                      [folderEnabled]="folderFeatureEnabled()"
                      [isLoggedIn]="auth.isLoggedIn()"
                      (statusToggle)="onStatusToggle($event)"
                      (folderClick)="folderPopover.openFromButton($event.item, $event.event)"
                      (watchlistToggle)="onWatchlistToggle($event)"
                      (removeClick)="onRemoveClick($event)" />
                  </li>
                }
              </ul>
            }
          </section>
        }
      </div>
    } @else if (viewMode() === 'grid') {
      <div class="content-grid">
        @for (entry of displayEntries(); track entry.key) {
          @if (entry.group) {
            <app-folder-card
              [group]="entry.group"
              [expanded]="entry.expanded"
              [dropActive]="dragDrop.isFolderDropActive(entry.group.id)"
              (toggle)="toggleFolder($event)"
              (dragOver)="dragDrop.onFolderDragOver($event.event, $event.group)"
              (dragLeave)="dragDrop.onFolderDragLeave($event)"
              (drop)="dragDrop.onFolderDrop($event.event, $event.group)">
              @if (entry.expanded) {
                @for (child of entry.group.items; track child.tmdb_id + '-' + child.media_type) {
                  <app-card
                    [item]="child"
                    [showRemove]="true"
                    [removeTitle]="kind() === 'watchlist' ? 'Rimuovi dalla lista' : 'Rimuovi dalla cronologia'"
                    [showProgress]="true"
                    [showStatusToggle]="kind() === 'watchlist'"
                    [showWatchlistToggle]="kind() === 'history' && auth.isLoggedIn()"
                    [showFolderAction]="folderFeatureEnabled()"
                    [draggable]="dragDrop.canDragItem(child)"
                    [dragging]="dragDrop.isDraggingItem(child)"
                    (cardClick)="onCardClick($event)"
                    (dragStarted)="dragDrop.onItemDragStart($event, child)"
                    (dragEnded)="dragDrop.onItemDragEnd()"
                    (watchlistToggleClick)="onWatchlistToggle($event)"
                    (statusToggleClick)="onStatusToggle($event)"
                    (folderClick)="folderPopover.openFromCardEvent($event)"
                    (removeClick)="onRemoveClick($event)" />
                }
              }
            </app-folder-card>
          } @else if (entry.item) {
            <app-card
              [item]="entry.item"
              [showRemove]="true"
              [removeTitle]="kind() === 'watchlist' ? 'Rimuovi dalla lista' : 'Rimuovi dalla cronologia'"
              [showProgress]="true"
              [showStatusToggle]="kind() === 'watchlist'"
              [showWatchlistToggle]="kind() === 'history' && auth.isLoggedIn()"
              [showFolderAction]="folderFeatureEnabled()"
              [draggable]="dragDrop.canDragItem(entry.item)"
              [dragging]="dragDrop.isDraggingItem(entry.item)"
              (cardClick)="onCardClick($event)"
              (dragStarted)="dragDrop.onItemDragStart($event, entry.item)"
              (dragEnded)="dragDrop.onItemDragEnd()"
              (watchlistToggleClick)="onWatchlistToggle($event)"
              (statusToggleClick)="onStatusToggle($event)"
              (folderClick)="folderPopover.openFromCardEvent($event)"
              (removeClick)="onRemoveClick($event)" />
          }
        }
      </div>
    } @else {
      <ul class="item-list">
        @for (entry of displayEntries(); track entry.key) {
          @if (entry.group) {
            <li class="folder-block">
              <app-folder-row
                [group]="entry.group"
                [expanded]="entry.expanded"
                [dropActive]="dragDrop.isFolderDropActive(entry.group.id)"
                (toggle)="toggleFolder($event)"
                (dragOver)="dragDrop.onFolderDragOver($event.event, $event.group)"
                (dragLeave)="dragDrop.onFolderDragLeave($event)"
                (drop)="dragDrop.onFolderDrop($event.event, $event.group)">
                @if (entry.expanded) {
                  @for (it of entry.group.items; track it.tmdb_id + '-' + it.media_type) {
                    <li class="item-row folder-child-row"
                        [class.item-row-draggable]="dragDrop.canDragItem(it)"
                        [class.item-row-dragging]="dragDrop.isDraggingItem(it)"
                        [attr.draggable]="dragDrop.canDragItem(it) ? 'true' : null"
                        (click)="onCardClick(it)"
                        (dragstart)="dragDrop.onItemDragStart($event, it)"
                        (dragend)="dragDrop.onItemDragEnd()">
                      <app-list-item-info [item]="it" />
                      <app-list-row-actions
                        [item]="it"
                        [kind]="kind()"
                        [folderEnabled]="folderFeatureEnabled()"
                        [isLoggedIn]="auth.isLoggedIn()"
                        (statusToggle)="onStatusToggle($event)"
                        (folderClick)="folderPopover.openFromButton($event.item, $event.event)"
                        (watchlistToggle)="onWatchlistToggle($event)"
                        (removeClick)="onRemoveClick($event)" />
                    </li>
                  }
                }
              </app-folder-row>
            </li>
          } @else if (entry.item) {
            <li class="item-row"
                [class.item-row-draggable]="dragDrop.canDragItem(entry.item)"
                [class.item-row-dragging]="dragDrop.isDraggingItem(entry.item)"
                [attr.draggable]="dragDrop.canDragItem(entry.item) ? 'true' : null"
                (click)="onCardClick(entry.item)"
                (dragstart)="dragDrop.onItemDragStart($event, entry.item)"
                (dragend)="dragDrop.onItemDragEnd()">
              <app-list-item-info [item]="entry.item" />
              <app-list-row-actions
                [item]="entry.item"
                [kind]="kind()"
                [folderEnabled]="folderFeatureEnabled()"
                [isLoggedIn]="auth.isLoggedIn()"
                (statusToggle)="onStatusToggle($event)"
                (folderClick)="folderPopover.openFromButton($event.item, $event.event)"
                (watchlistToggle)="onWatchlistToggle($event)"
                (removeClick)="onRemoveClick($event)" />
            </li>
          }
        }
      </ul>
    }

    <ui-confirm-modal
      [(open)]="confirmAction.open"
      [title]="confirmAction.title()"
      [message]="confirmAction.message()"
      [warning]="confirmAction.warning()"
      [actionLabel]="confirmAction.actionLabel()"
      (cancelled)="confirmAction.cancel()"
      (confirmed)="confirmPendingAction()" />

    <ui-popover [(open)]="folderPopover.open"
                [anchor]="folderPopover.anchor()"
                [width]="folderPopover.targetHasFolder() ? 430 : 350"
                [preferredHeight]="130"
                icon="folder"
                [title]="folderPopover.targetItem()?.title ?? 'Folder'"
                [secondary]="folderPopover.targetHasFolder()
                  ? 'Folder attuale: ' + (folderPopover.targetItem()?.folderName ?? '')
                  : 'Aggiungi o aggiorna il folder del titolo'"
                (closed)="folderPopover.close()">
      <div class="folder-popover-bar">
        <input uiInput="dense" class="folder-popover-input"
               type="text"
               maxlength="60"
               [value]="folderPopover.draft()"
               placeholder="Titolo folder"
               (input)="folderPopover.onDraftInput($event)">

        <div class="folder-popover-actions">
          <button uiButton="primary" uiButtonSize="dense" type="button"
                  [uiPending]="folderPopover.saving()"
                  [disabled]="!folderPopover.canSave()"
                  (click)="folderPopover.save()">
            {{ folderPopover.targetHasFolder() ? 'Aggiorna' : 'Aggiungi' }}
          </button>

          @if (folderPopover.targetHasFolder()) {
            <button uiButton="danger-outline" uiButtonSize="dense" type="button"
                    [uiPending]="folderPopover.saving()"
                    (click)="folderPopover.remove()">
              Rimuovi
            </button>
          } @else {
            <button uiButton="ghost" uiButtonSize="dense" type="button"
                    [disabled]="folderPopover.saving()"
                    (click)="folderPopover.close()">
              Chiudi
            </button>
          }
        </div>
      </div>
    </ui-popover>
  `,
  styleUrl: './user-list-view.component.css'
})
export class UserListViewComponent {
  protected readonly auth = inject(AuthService);
  private readonly tmdb = inject(TmdbService);
  private readonly watchlist = inject(WatchlistService);
  private readonly history = inject(HistoryService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly navSource = inject(NavigationSourceService);

  readonly kind = input.required<UserListType>();

  protected readonly statusTabs = STATUS_TABS;
  protected readonly mediaTabs = MEDIA_TABS;
  protected readonly statusFilter = signal<WatchlistListStatusFilter>(loadStatusFilter());
  protected readonly mediaFilter = signal<MediaFilter>(loadMediaFilter());
  protected readonly viewMode = signal<ViewMode>(loadViewMode());

  protected readonly items = signal<CardItem[]>([]);
  protected readonly loading = signal(false);
  protected readonly expandedFolders = signal<Record<string, boolean>>(loadExpandedFolders());
  protected readonly totalWatchTimeSeconds = signal(0);
  protected readonly animatedWatchTimeSeconds = signal(0);
  protected readonly title = computed(() => (
    this.kind() === 'watchlist' ? 'La mia lista' : 'Cronologia'
  ));
  protected readonly folderFeatureEnabled = computed(
    () => this.kind() === 'watchlist' && this.auth.currentUser()?.folders_enabled === 1
  );
  protected readonly displayEntries = computed(() => (
    buildDisplayEntries(this.items(), this.folderFeatureEnabled(), this.expandedFolders())
  ));
  protected readonly historySections = computed(() => (
    this.kind() === 'history' ? buildHistorySections(this.items()) : []
  ));
  protected readonly historyWatchTimeCounter = computed<WatchTimeCounter>(() => (
    formatWatchTimeCounter(this.animatedWatchTimeSeconds())
  ));
  protected readonly historyWatchTimeAriaLabel = computed(() => (
    `WatchTime totale account: ${formatWatchTimeAriaLabel(this.totalWatchTimeSeconds())}`
  ));

  protected readonly folderPopover = new FolderPopoverController({
    enabled: this.folderFeatureEnabled,
    applyFolderChange: (item, name, msg, close) => this.applyFolderChange(item, name, msg, close)
  });

  protected readonly dragDrop = new DragDropController({
    kind: this.kind,
    enabled: this.folderFeatureEnabled,
    applyFolderChange: (item, name, msg) => this.applyFolderChange(item, name, msg)
  });

  protected readonly confirmAction = new ConfirmActionController(this.kind);

  protected readonly emptyTitle = computed(() => {
    const media = this.mediaFilter();
    const status = this.statusFilter();
    if (this.kind() !== 'watchlist') {
      return media === 'all'
        ? 'La cronologia è vuota'
        : `Nessun ${mediaLabel(media)} nella cronologia`;
    }
    if (status === 'unreleased') {
      if (media === 'tv') return 'Nessuna serie TV non ancora uscita';
      if (media === 'movie') return 'Nessun film non ancora uscito';
      return 'Nessun contenuto non ancora uscito';
    }
    if (status === 'done') {
      return media === 'all'
        ? 'Nessun titolo segnato come visto'
        : `Nessun ${mediaLabel(media)} segnato come visto`;
    }
    if (status === 'in_progress') {
      return media === 'all'
        ? 'Nessun titolo in corso'
        : `Nessun ${mediaLabel(media)} in corso`;
    }
    return media === 'all'
      ? 'La tua lista è vuota'
      : `Nessun ${mediaLabel(media)} nella tua lista`;
  });

  protected readonly emptyHint = computed(() => {
    const media = this.mediaFilter();
    const status = this.statusFilter();
    if (this.kind() !== 'watchlist') {
      return media === 'all'
        ? 'Qui troverai episodi e film che hai iniziato o completato.'
        : `Prova a cambiare filtro o inizia a guardare ${mediaHintTarget(media)}.`;
    }
    if (status === 'unreleased') {
      return 'I titoli in arrivo che aggiungi alla lista appariranno qui automaticamente.';
    }
    if (status === 'done') {
      return 'I titoli che marchi come visti dal pulsante check appariranno qui.';
    }
    if (status === 'in_progress') {
      return 'I titoli che inizi a guardare appariranno qui.';
    }
    return `Apri ${mediaHintTarget(media)} e clicca il segnalibro per aggiungerl${media === 'tv' ? 'a' : 'o'} alla tua lista.`;
  });

  private seq = 0;

  constructor() {
    effect(() => {
      const media = this.mediaFilter();
      const kind = this.kind();
      const status = kind === 'watchlist' ? this.statusFilter() : undefined;
      this.auth.currentUser();
      this.watchlist.tick();
      void this.load(kind, media, status);
    });

    effect(() => {
      persistMediaFilter(this.mediaFilter());
    });
    effect(() => {
      persistStatusFilter(this.statusFilter());
    });
    effect(() => {
      persistExpandedFolders(this.expandedFolders());
    });

    effect(() => {
      if (!this.folderFeatureEnabled() && this.folderPopover.open()) {
        this.folderPopover.close();
      }
    });

    effect((onCleanup) => {
      if (this.kind() !== 'history') {
        this.animatedWatchTimeSeconds.set(0);
        return;
      }

      const target = this.totalWatchTimeSeconds();
      const startValue = this.animatedWatchTimeSeconds();
      if (target === startValue) return;

      let frameId = 0;
      const startedAt = performance.now();
      const durationMs = 900;

      const loop = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / durationMs);
        const eased = 1 - Math.pow(1 - progress, 3);
        const nextValue = Math.round(startValue + (target - startValue) * eased);
        this.animatedWatchTimeSeconds.set(nextValue);
        if (progress < 1) {
          frameId = window.requestAnimationFrame(loop);
        }
      };

      frameId = window.requestAnimationFrame(loop);
      onCleanup(() => window.cancelAnimationFrame(frameId));
    });
  }

  protected setViewMode(mode: ViewMode): void {
    this.viewMode.set(mode);
    persistViewMode(mode);
  }

  protected back(): void {
    this.navSource.goBack('/browse');
  }

  protected goToSearch(): void {
    void this.router.navigate(['/search']);
  }

  protected goToBrowse(): void {
    void this.router.navigate(['/browse']);
  }

  protected toggleFolder(folderId: string): void {
    if (this.dragDrop.recentlyDropped()) return;
    this.expandedFolders.update((state) => ({ ...state, [folderId]: !state[folderId] }));
  }

  protected readonly cardKey = cardKey;

  protected onCardClick(item: CardItem): void {
    const queryParams: Record<string, number> = {};
    const season = this.kind() === 'history'
      ? item.season
      : (item.resumeSeason ?? item.season);
    const episode = this.kind() === 'history'
      ? item.episode
      : (item.resumeEpisode ?? item.episode);
    if (season) queryParams['s'] = season;
    if (episode) queryParams['e'] = episode;
    void this.router.navigate(['/watch', item.media_type, item.tmdb_id], { queryParams });
  }

  protected async onRemoveClick(item: CardItem): Promise<void> {
    this.confirmAction.request({ type: 'remove-item', item });
  }

  protected async onStatusToggle(item: CardItem): Promise<void> {
    if (this.kind() !== 'watchlist') return;
    const { next, requiresConfirmation } = getStatusTransition(item.status);

    if (requiresConfirmation) {
      this.confirmAction.request({ type: 'mark-done', item });
      return;
    }

    await runCardMutation(this.items, item, 'status', async () => {
      const ok = await this.watchlist.setStatus(item.tmdb_id, item.media_type, next);
      if (!ok) {
        this.toast.show('Errore di rete, riprova');
        return;
      }
      this.items.update(items => items.map(candidate => (
        candidate.tmdb_id === item.tmdb_id && candidate.media_type === item.media_type
          ? { ...candidate, status: next }
          : candidate
      )));
      this.toast.show(getStatusToastMessage(item.title, next));
      void this.load(this.kind(), this.mediaFilter(), this.statusFilter());
    });
  }

  protected async onWatchlistToggle(item: CardItem): Promise<void> {
    if (this.kind() !== 'history' || !this.auth.isLoggedIn()) return;
    if (item.inWatchlist) {
      this.confirmAction.request({ type: 'remove-watchlist', item });
      return;
    }
    await runCardMutation(this.items, item, 'watchlist', async () => {
      const result = await toggleCardWatchlist(item, this.watchlist);
      if (result.ok) {
        this.items.update((items) => setCardWatchlistFlag(items, item, result.inWatchlist));
      }
      this.toast.show(result.message);
    });
  }

  protected async confirmPendingAction(): Promise<void> {
    const action = this.confirmAction.consume();
    if (!action) return;

    if (action.type === 'mark-done') {
      await runCardMutation(this.items, action.item, 'status', async () => {
        const ok = await this.watchlist.setStatus(action.item.tmdb_id, action.item.media_type, 'done');
        if (!ok) {
          this.toast.show('Errore di rete, riprova');
          return;
        }
        this.toast.show(`${action.item.title}: segnato come visto`);
        void this.load(this.kind(), this.mediaFilter(), this.statusFilter());
      });
      return;
    }

    if (action.type === 'remove-watchlist') {
      await runCardMutation(this.items, action.item, 'watchlist', async () => {
        const ok = await this.watchlist.remove(action.item.tmdb_id, action.item.media_type);
        if (!ok) {
          this.toast.show('Errore di rete, riprova');
          return;
        }
        this.items.update((items) => setCardWatchlistFlag(items, action.item, false));
        this.toast.show(`${action.item.title}: rimosso dalla lista`);
      });
      return;
    }

    const item = action.item;
    const matcher = this.kind() === 'history' ? isSameHistoryEntry : undefined;
    await runCardMutation(this.items, item, 'remove', async () => {
      if (this.kind() === 'watchlist') {
        const ok = await this.watchlist.remove(item.tmdb_id, item.media_type);
        if (!ok) {
          this.toast.show('Errore di rete, riprova');
          return;
        }
        this.toast.show(`${item.title}: rimosso dalla lista`);
      } else {
        const ok = await this.history.remove(item.tmdb_id, item.media_type, item.season, item.episode);
        if (!ok) {
          this.toast.show('Errore di rete, riprova');
          return;
        }
        this.totalWatchTimeSeconds.update((total) => (
          Math.max(0, total - historyItemWatchTimeSeconds(item))
        ));
        this.toast.show(`${item.title}: rimosso dalla cronologia`);
      }
      this.items.update(arr => arr.filter(i => (
        this.kind() === 'watchlist'
          ? !(i.tmdb_id === item.tmdb_id && i.media_type === item.media_type)
          : !isSameHistoryEntry(i, item)
      )));
    }, matcher ?? ((a, b) => a.tmdb_id === b.tmdb_id && a.media_type === b.media_type));
  }

  private async applyFolderChange(
    item: CardItem,
    folderName: string | null,
    successMessage: string,
    closeModal = false
  ): Promise<void> {
    await runCardMutation(this.items, item, 'folder', async () => {
      const ok = await this.watchlist.setFolder(item.tmdb_id, item.media_type, folderName);
      if (!ok) {
        this.toast.show('Errore di rete, riprova');
        return;
      }
      this.items.update((items) => items.map((candidate) => (
        candidate.tmdb_id === item.tmdb_id && candidate.media_type === item.media_type
          ? { ...candidate, folderName }
          : candidate
      )));
      if (folderName) {
        this.expandedFolders.update((state) => ({ ...state, [folderIdFromName(folderName)]: true }));
      }
      this.toast.show(successMessage);
      if (closeModal) {
        this.folderPopover.close();
      }
    });
  }

  private async load(kind: UserListType, media: MediaFilter, status?: WatchlistListStatusFilter): Promise<void> {
    const mySeq = ++this.seq;
    this.loading.set(true);
    this.items.set([]);
    const mediaType = media === 'all' ? undefined : media as BackendMediaFilter;
    if (kind === 'watchlist') {
      this.totalWatchTimeSeconds.set(0);
      const list = await this.watchlist.list({ status, ...(mediaType ? { media_type: mediaType } : {}) });
      if (mySeq !== this.seq) return;
      const items = await enrichLibraryCardsWithTmdb(list.map(watchlistToCardItem), this.tmdb);
      if (mySeq !== this.seq) return;
      this.items.set(items);
    } else {
      const [historyData, watchlist] = await Promise.all([
        this.history.listWithSummary(mediaType ? { media_type: mediaType } : undefined),
        this.watchlist.list()
      ]);
      if (mySeq !== this.seq) return;
      this.totalWatchTimeSeconds.set(historyData.account_watch_time_seconds ?? 0);
      const items = await enrichLibraryCardsWithTmdb(
        applyWatchlistFlags(historyData.items.map(historyToCardItem), watchlist),
        this.tmdb
      );
      if (mySeq !== this.seq) return;
      this.items.set(items);
    }
    this.loading.set(false);
  }
}

function mediaLabel(filter: MediaFilter): string {
  return filter === 'tv' ? 'serie TV' : filter === 'movie' ? 'film' : 'titolo';
}

function mediaHintTarget(filter: MediaFilter): string {
  if (filter === 'tv') return 'una serie TV';
  if (filter === 'movie') return 'un film';
  return 'un film o una serie';
}

function formatWatchTimeCounter(totalSeconds: number): WatchTimeCounter {
  if (totalSeconds <= 0) {
    return { value: '0', unit: 'min' };
  }

  if (totalSeconds >= 3600) {
    const hours = totalSeconds / 3600;
    const formatted = new Intl.NumberFormat('it-IT', {
      minimumFractionDigits: hours < 10 ? 1 : 0,
      maximumFractionDigits: hours < 10 ? 1 : 0
    }).format(hours);
    return { value: formatted, unit: 'ore' };
  }

  const minutes = Math.max(1, Math.round(totalSeconds / 60));
  return {
    value: minutes.toLocaleString('it-IT'),
    unit: 'min'
  };
}

function formatWatchTimeAriaLabel(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0 minuti';

  if (totalSeconds >= 3600) {
    const totalMinutes = Math.round(totalSeconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes > 0 ? `${hours} ore e ${minutes} minuti` : `${hours} ore`;
  }

  const minutes = Math.max(1, Math.round(totalSeconds / 60));
  return `${minutes} minuti`;
}

function historyItemWatchTimeSeconds(item: CardItem): number {
  const position = item.position ?? 0;
  const duration = item.duration ?? 0;
  if (item.completed && duration > 0) return Math.round(duration);
  if (position > 0 && duration > 0) return Math.round(Math.min(position, duration));
  if (position > 0) return Math.round(position);
  return 0;
}
