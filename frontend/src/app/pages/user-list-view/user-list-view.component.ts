import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CardComponent } from '../../components/card/card.component';
import { BackButtonComponent } from '../../ui/back-button/back-button.component';
import { IconComponent } from '../../ui/icon/icon.component';
import { ConfirmModalComponent } from '../../ui/confirm-modal/confirm-modal.component';
import { PendingButtonDirective } from '../../ui/pending-button.directive';
import { UiTabsComponent, UiTab } from '../../ui/tabs/tabs.component';
import { UiModalComponent } from '../../ui/modal/modal.component';
import { AuthService } from '../../services/auth.service';
import { TmdbService } from '../../services/tmdb.service';
import { WatchlistService } from '../../services/watchlist.service';
import { HistoryService } from '../../services/history.service';
import { ToastService } from '../../services/toast.service';
import { NavigationSourceService } from '../../services/navigation-source.service';
import { enrichCardsWithTmdb } from '../../utils/card-item.util';
import { applyWatchlistFlags, runCardMutation, setCardWatchlistFlag, toggleCardWatchlist } from '../../utils/card-watchlist.util';
import type { CardItem, WatchlistStatus } from '../../models';

export type UserListType = 'watchlist' | 'history';
export type ViewMode = 'grid' | 'list';
type MediaFilter = 'all' | 'tv' | 'movie';
type BackendMediaFilter = Exclude<MediaFilter, 'all'>;
type PendingAction =
  | { type: 'remove-item'; item: CardItem }
  | { type: 'mark-done'; item: CardItem }
  | { type: 'remove-watchlist'; item: CardItem };

interface FolderGroup {
  id: string;
  name: string;
  items: CardItem[];
  count: number;
  movieCount: number;
  tvCount: number;
}

interface DisplayEntry {
  key: string;
  item: CardItem | null;
  group: FolderGroup | null;
  expanded: boolean;
}

const VIEW_MODE_KEY = 'streamo.user-list.view-mode';
const MEDIA_FILTER_KEY = 'streamo.user-list.media-filter';
const STATUS_FILTER_KEY = 'streamo.user-list.status-filter';
const EXPANDED_FOLDERS_KEY = 'streamo.user-list.expanded-folders';

const STATUS_TABS: ReadonlyArray<UiTab<WatchlistStatus>> = [
  { value: 'todo', label: 'Da guardare' },
  { value: 'done', label: 'Visto' }
];

const MEDIA_TABS: ReadonlyArray<UiTab<MediaFilter>> = [
  { value: 'all', label: 'Tutti' },
  { value: 'tv', label: 'TV' },
  { value: 'movie', label: 'Film' }
];

@Component({
  selector: 'app-user-list-view',
  standalone: true,
  imports: [
    CardComponent,
    BackButtonComponent,
    IconComponent,
    ConfirmModalComponent,
    PendingButtonDirective,
    UiTabsComponent,
    UiModalComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div class="page-header-back">
        <ui-back-button (pressed)="back()" />
      </div>
      <div class="page-header-row">
        <h2>{{ title() }}</h2>
        <div class="page-actions">
          <div class="view-toggle" role="group" aria-label="Modalita visualizzazione">
            <button class="view-btn" [class.active]="viewMode() === 'grid'"
                    aria-label="Griglia" (click)="setViewMode('grid')">
              <app-icon name="grid"></app-icon>
            </button>
            <button class="view-btn" [class.active]="viewMode() === 'list'"
                    aria-label="Lista" (click)="setViewMode('list')">
              <app-icon name="list"></app-icon>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="filter-bar">
      @if (kind() === 'watchlist') {
        <ui-tabs [tabs]="statusTabs" [(value)]="statusFilter" />
      }
      <ui-tabs [tabs]="mediaTabs" [(value)]="mediaFilter" />
    </div>

    @if (draggedItem()) {
      <div class="drag-drop-bar">
        <div class="drag-remove-zone"
             [class.active]="dropRemoveActive()"
             (dragover)="onRemoveDragOver($event)"
             (dragleave)="onRemoveDragLeave()"
             (drop)="onRemoveDrop($event)">
          <app-icon name="trash"></app-icon>
          <span>Rimuovi {{ draggedItem()!.title }}</span>
        </div>
      </div>
    }

    @if (loading()) {
      <div class="loading"><div class="spinner"></div></div>
    } @else if (items().length === 0) {
      <div class="empty-state">
        <p class="empty-state-title">{{ emptyTitle() }}</p>
        <p class="empty-state-hint">{{ emptyHint() }}</p>
        <div class="empty-state-actions">
          @if (kind() === 'watchlist') {
            <button class="primary-btn" (click)="goToSearch()">Vai a cercare</button>
          } @else {
            <button class="primary-btn" (click)="goToBrowse()">Scopri film popolari</button>
          }
        </div>
      </div>
    } @else if (viewMode() === 'grid') {
      <div class="content-grid">
        @for (entry of displayEntries(); track entry.key) {
          @if (entry.group) {
            <button class="folder-card"
                    [class.expanded]="entry.expanded"
                    [class.folder-drop-active]="isFolderDropActive(entry.group.id)"
                    [attr.aria-expanded]="entry.expanded"
                    (click)="toggleFolder(entry.group.id)"
                    (dragover)="onFolderDragOver($event, entry.group)"
                    (dragleave)="onFolderDragLeave(entry.group.id)"
                    (drop)="onFolderDrop($event, entry.group)">
              <span class="folder-card-icon">
                <app-icon name="folder"></app-icon>
              </span>
              <span class="folder-card-body">
                <span class="folder-card-title">{{ entry.group.name }}</span>
                <span class="folder-card-meta">{{ folderGridMeta(entry.group) }}</span>
              </span>
              <span class="folder-card-chevron" [class.expanded]="entry.expanded">
                <app-icon name="chevron-down"></app-icon>
              </span>
            </button>
            @if (entry.expanded) {
              <div class="folder-card-panel">
                <div class="folder-card-panel-grid">
                  @for (child of entry.group.items; track child.tmdb_id + '-' + child.media_type) {
                    <app-card
                      [item]="child"
                      [showRemove]="true"
                      [removeTitle]="kind() === 'watchlist' ? 'Rimuovi dalla lista' : 'Rimuovi dalla cronologia'"
                      [showProgress]="true"
                      [showStatusToggle]="kind() === 'watchlist'"
                      [showWatchlistToggle]="kind() === 'history' && auth.isLoggedIn()"
                      [showFolderAction]="folderFeatureEnabled()"
                      [draggable]="canDragItem(child)"
                      [dragging]="isDraggingItem(child)"
                      (cardClick)="onCardClick($event)"
                      (dragStarted)="onItemDragStart($event, child)"
                      (dragEnded)="onItemDragEnd()"
                      (watchlistToggleClick)="onWatchlistToggle($event)"
                      (statusToggleClick)="onStatusToggle($event)"
                      (folderClick)="openFolderModal($event)"
                      (removeClick)="onRemoveClick($event)" />
                  }
                </div>
              </div>
            }
          } @else if (entry.item) {
            <app-card
              [item]="entry.item"
              [showRemove]="true"
              [removeTitle]="kind() === 'watchlist' ? 'Rimuovi dalla lista' : 'Rimuovi dalla cronologia'"
              [showProgress]="true"
              [showStatusToggle]="kind() === 'watchlist'"
              [showWatchlistToggle]="kind() === 'history' && auth.isLoggedIn()"
              [showFolderAction]="folderFeatureEnabled()"
              [draggable]="canDragItem(entry.item)"
              [dragging]="isDraggingItem(entry.item)"
              (cardClick)="onCardClick($event)"
              (dragStarted)="onItemDragStart($event, entry.item)"
              (dragEnded)="onItemDragEnd()"
              (watchlistToggleClick)="onWatchlistToggle($event)"
              (statusToggleClick)="onStatusToggle($event)"
              (folderClick)="openFolderModal($event)"
              (removeClick)="onRemoveClick($event)" />
          }
        }
      </div>
    } @else {
      <ul class="item-list">
        @for (entry of displayEntries(); track entry.key) {
          @if (entry.group) {
            <li class="folder-block">
              <button class="folder-row"
                      [class.expanded]="entry.expanded"
                      [class.folder-drop-active]="isFolderDropActive(entry.group.id)"
                      [attr.aria-expanded]="entry.expanded"
                      (click)="toggleFolder(entry.group.id)"
                      (dragover)="onFolderDragOver($event, entry.group)"
                      (dragleave)="onFolderDragLeave(entry.group.id)"
                      (drop)="onFolderDrop($event, entry.group)">
                <span class="folder-row-main">
                  <span class="folder-pill">
                    <app-icon name="folder"></app-icon>
                  </span>
                  <span class="folder-row-copy">
                    <span class="folder-row-title">{{ entry.group.name }}</span>
                    <span class="folder-row-meta">{{ folderListMeta(entry.group) }}</span>
                  </span>
                </span>
                <span class="folder-row-arrow" [class.expanded]="entry.expanded">
                  <app-icon name="chevron-down"></app-icon>
                </span>
              </button>

              @if (entry.expanded) {
                <ul class="folder-items">
                  @for (it of entry.group.items; track it.tmdb_id + '-' + it.media_type) {
                    <li class="item-row folder-child-row"
                        [class.item-row-draggable]="canDragItem(it)"
                        [class.item-row-dragging]="isDraggingItem(it)"
                        [attr.draggable]="canDragItem(it) ? 'true' : null"
                        (click)="onCardClick(it)"
                        (dragstart)="onItemDragStart($event, it)"
                        (dragend)="onItemDragEnd()">
                      <span class="item-type">{{ it.media_type === 'tv' ? 'TV' : 'Film' }}</span>
                      <div class="item-info">
                        <span class="item-title">{{ it.title }}</span>
                        @if (it.season && it.episode || it.watchStatus || it.nextReleaseText) {
                          <span class="item-sub">
                            @if (it.season && it.episode) {
                              <span class="item-meta">S{{ it.season }} E{{ it.episode }}</span>
                            }
                            @if (it.watchStatus) {
                              <span class="item-watch-status">{{ it.watchStatus }}</span>
                            }
                            @if (it.nextReleaseText) {
                              <span class="item-release-status">{{ it.nextReleaseText }}</span>
                            }
                          </span>
                        }
                      </div>
                      @if (kind() === 'watchlist' && !it.isUpcoming) {
                        <button class="row-action row-status"
                                [uiPending]="!!it.pendingAction"
                                [class.done]="it.status === 'done'"
                                [title]="it.status === 'done' ? 'Segna da guardare' : 'Segna come visto'"
                                (click)="onStatusToggle(it); $event.stopPropagation()">
                          <app-icon name="check"></app-icon>
                        </button>
                      }
                      @if (kind() === 'watchlist' && folderFeatureEnabled()) {
                        <button class="row-action row-folder"
                                [uiPending]="!!it.pendingAction"
                                [class.active]="!!it.folderName"
                                [title]="it.folderName ? 'Modifica folder' : 'Assegna folder'"
                                (click)="openFolderModal(it); $event.stopPropagation()">
                          <app-icon name="folder"></app-icon>
                        </button>
                      }
                      @if (kind() === 'history' && auth.isLoggedIn()) {
                        <button class="row-action row-watchlist"
                                [uiPending]="!!it.pendingAction"
                                [class.active]="it.inWatchlist === true"
                                [title]="it.inWatchlist ? 'Rimuovi dalla lista' : 'Aggiungi alla lista'"
                                (click)="onWatchlistToggle(it); $event.stopPropagation()">
                          <app-icon name="bookmark"></app-icon>
                        </button>
                      }
                      <button class="row-action row-remove"
                              [uiPending]="!!it.pendingAction"
                              [title]="kind() === 'watchlist' ? 'Rimuovi dalla lista' : 'Rimuovi dalla cronologia'"
                              (click)="onRemoveClick(it); $event.stopPropagation()">
                        <app-icon name="trash"></app-icon>
                      </button>
                    </li>
                  }
                </ul>
              }
            </li>
          } @else if (entry.item) {
            <li class="item-row"
                [class.item-row-draggable]="canDragItem(entry.item)"
                [class.item-row-dragging]="isDraggingItem(entry.item)"
                [attr.draggable]="canDragItem(entry.item) ? 'true' : null"
                (click)="onCardClick(entry.item)"
                (dragstart)="onItemDragStart($event, entry.item)"
                (dragend)="onItemDragEnd()">
              <span class="item-type">{{ entry.item.media_type === 'tv' ? 'TV' : 'Film' }}</span>
              <div class="item-info">
                <span class="item-title">{{ entry.item.title }}</span>
                @if (entry.item.season && entry.item.episode || entry.item.watchStatus || entry.item.nextReleaseText) {
                  <span class="item-sub">
                    @if (entry.item.season && entry.item.episode) {
                      <span class="item-meta">S{{ entry.item.season }} E{{ entry.item.episode }}</span>
                    }
                    @if (entry.item.watchStatus) {
                      <span class="item-watch-status">{{ entry.item.watchStatus }}</span>
                    }
                    @if (entry.item.nextReleaseText) {
                      <span class="item-release-status">{{ entry.item.nextReleaseText }}</span>
                    }
                  </span>
                }
              </div>
              @if (kind() === 'watchlist' && !entry.item.isUpcoming) {
                <button class="row-action row-status"
                        [uiPending]="!!entry.item.pendingAction"
                        [class.done]="entry.item.status === 'done'"
                        [title]="entry.item.status === 'done' ? 'Segna da guardare' : 'Segna come visto'"
                        (click)="onStatusToggle(entry.item); $event.stopPropagation()">
                  <app-icon name="check"></app-icon>
                </button>
              }
              @if (kind() === 'watchlist' && folderFeatureEnabled()) {
                <button class="row-action row-folder"
                        [uiPending]="!!entry.item.pendingAction"
                        [class.active]="!!entry.item.folderName"
                        [title]="entry.item.folderName ? 'Modifica folder' : 'Assegna folder'"
                        (click)="openFolderModal(entry.item); $event.stopPropagation()">
                  <app-icon name="folder"></app-icon>
                </button>
              }
              @if (kind() === 'history' && auth.isLoggedIn()) {
                <button class="row-action row-watchlist"
                        [uiPending]="!!entry.item.pendingAction"
                        [class.active]="entry.item.inWatchlist === true"
                        [title]="entry.item.inWatchlist ? 'Rimuovi dalla lista' : 'Aggiungi alla lista'"
                        (click)="onWatchlistToggle(entry.item); $event.stopPropagation()">
                  <app-icon name="bookmark"></app-icon>
                </button>
              }
              <button class="row-action row-remove"
                      [uiPending]="!!entry.item.pendingAction"
                      [title]="kind() === 'watchlist' ? 'Rimuovi dalla lista' : 'Rimuovi dalla cronologia'"
                      (click)="onRemoveClick(entry.item); $event.stopPropagation()">
                <app-icon name="trash"></app-icon>
              </button>
            </li>
          }
        }
      </ul>
    }

    <ui-confirm-modal
      [(open)]="confirmModalOpen"
      [title]="confirmModalTitle()"
      [message]="confirmModalMessage()"
      [warning]="confirmModalWarning()"
      [actionLabel]="confirmModalActionLabel()"
      (cancelled)="cancelPendingAction()"
      (confirmed)="confirmPendingAction()" />

    <ui-modal [(open)]="folderModalOpen" title="Folder" size="sm" (closed)="closeFolderModal()">
      <div class="folder-modal-content">
        <div class="folder-modal-header">
          <span class="folder-modal-icon">
            <app-icon name="folder"></app-icon>
          </span>
          <div class="folder-modal-copy">
            <strong>{{ folderTargetItem()?.title }}</strong>
            <span class="folder-modal-sub">Assegna un folder esistente oppure creane uno nuovo.</span>
            @if (folderTargetHasFolder()) {
              <span class="folder-current">Attuale: {{ folderTargetItem()?.folderName }}</span>
            }
          </div>
        </div>

        @if (existingFolders().length > 0) {
          <div class="folder-section">
            <span class="folder-section-label">Folder esistenti</span>
            <div class="folder-chip-list">
              @for (folder of existingFolders(); track folder) {
                <button class="folder-chip"
                        [class.active]="folderDraft() === folder"
                        (click)="selectFolder(folder)">
                  {{ folder }}
                </button>
              }
            </div>
          </div>
        }

        <label class="folder-field">
          <span>Nome folder</span>
          <input type="text"
                 maxlength="60"
                 [value]="folderDraft()"
                 placeholder="Es. Marvel, Da vedere insieme"
                 (input)="onFolderDraftInput($event)">
          <small>Il nome viene condiviso con gli altri titoli che assegni allo stesso folder.</small>
        </label>

        <div class="folder-modal-actions">
          <button class="secondary-btn danger-outline"
                  [disabled]="!folderTargetHasFolder() || savingFolder()"
                  (click)="removeFolder()">
            Rimuovi folder
          </button>
          <div class="folder-modal-actions-main">
            <button class="secondary-btn" (click)="closeFolderModal()">Annulla</button>
            <button class="primary-btn"
                    [uiPending]="savingFolder()"
                    [disabled]="!canSaveFolder()"
                    (click)="saveFolder()">
              Salva
            </button>
          </div>
        </div>
      </div>
    </ui-modal>
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
  protected readonly statusFilter = signal<WatchlistStatus>(loadStatusFilter());
  protected readonly mediaFilter = signal<MediaFilter>(loadMediaFilter());
  protected readonly viewMode = signal<ViewMode>(loadViewMode());

  protected readonly items = signal<CardItem[]>([]);
  protected readonly loading = signal(false);
  protected readonly confirmModalOpen = signal(false);
  protected readonly pendingAction = signal<PendingAction | null>(null);
  protected readonly folderModalOpen = signal(false);
  protected readonly folderTargetItem = signal<CardItem | null>(null);
  protected readonly folderDraft = signal('');
  protected readonly savingFolder = signal(false);
  protected readonly expandedFolders = signal<Record<string, boolean>>(loadExpandedFolders());
  protected readonly draggedItem = signal<CardItem | null>(null);
  protected readonly dropFolderId = signal<string | null>(null);
  protected readonly dropRemoveActive = signal(false);
  protected readonly title = computed(() => this.kind() === 'watchlist' ? 'La mia lista' : 'Cronologia');
  protected readonly folderFeatureEnabled = computed(
    () => this.kind() === 'watchlist' && this.auth.currentUser()?.folders_enabled === 1
  );
  protected readonly displayEntries = computed(() => (
    buildDisplayEntries(this.items(), this.folderFeatureEnabled(), this.expandedFolders())
  ));
  protected readonly existingFolders = computed(() => (
    this.displayEntries()
      .flatMap((entry) => entry.group ? [entry.group.name] : [])
  ));
  protected readonly canSaveFolder = computed(() => {
    const target = this.folderTargetItem();
    if (!target) return false;
    const nextFolder = normalizeFolderName(this.folderDraft());
    return nextFolder !== null && nextFolder !== normalizeFolderName(target.folderName ?? null);
  });
  protected readonly folderTargetHasFolder = computed(() => (
    normalizeFolderName(this.folderTargetItem()?.folderName ?? null) !== null
  ));

  protected readonly emptyTitle = computed(() => {
    const media = this.mediaFilter();
    if (this.kind() !== 'watchlist') {
      return media === 'all'
        ? 'La cronologia è vuota'
        : `Nessun ${mediaLabel(media)} nella cronologia`;
    }
    if (this.statusFilter() === 'done') {
      return media === 'all'
        ? 'Nessun titolo segnato come visto'
        : `Nessun ${mediaLabel(media)} segnato come visto`;
    }
    return media === 'all'
      ? 'La tua lista è vuota'
      : `Nessun ${mediaLabel(media)} nella tua lista`;
  });

  protected readonly emptyHint = computed(() => {
    const media = this.mediaFilter();
    if (this.kind() !== 'watchlist') {
      return media === 'all'
        ? 'I titoli che inizi a guardare verranno tracciati qui.'
        : `Prova a cambiare filtro o inizia a guardare ${mediaHintTarget(media)}.`;
    }
    if (this.statusFilter() === 'done') {
      return 'I titoli che marchi come visti dal pulsante check appariranno qui.';
    }
    return `Apri ${mediaHintTarget(media)} e clicca il segnalibro per aggiungerl${media === 'tv' ? 'a' : 'o'} alla tua lista.`;
  });

  protected readonly confirmModalTitle = computed(() => {
    const action = this.pendingAction();
    if (!action) return 'Conferma';
    if (action.type === 'mark-done') return 'Segna Come Visto';
    if (action.type === 'remove-watchlist') return 'Rimuovi Dalla Lista';
    return this.kind() === 'watchlist' ? 'Rimuovi Dalla Lista' : 'Rimuovi Dalla Cronologia';
  });

  protected readonly confirmModalMessage = computed(() => {
    const action = this.pendingAction();
    const item = action?.item;
    if (!item) return '';
    if (action.type === 'mark-done') {
      return `Vuoi segnare ${item.title} come visto?`;
    }
    if (action.type === 'remove-watchlist') {
      return `Vuoi rimuovere ${item.title} dalla tua lista?`;
    }
    return this.kind() === 'watchlist'
      ? `Vuoi rimuovere ${item.title} dalla tua lista?`
      : `Vuoi rimuovere ${item.title} dalla cronologia?`;
  });

  protected readonly confirmModalWarning = computed(() => {
    const action = this.pendingAction();
    if (!action) return '';
    if (action.type === 'mark-done') return 'Il titolo verrà spostato nella sezione "Visto".';
    if (action.type === 'remove-watchlist') return 'Potrai sempre riaggiungerlo più tardi.';
    return this.kind() === 'watchlist'
      ? 'Potrai sempre riaggiungerlo più tardi.'
      : 'Questa voce sparirà dalla cronologia.';
  });

  protected readonly confirmModalActionLabel = computed(() => {
    return this.pendingAction()?.type === 'mark-done' ? 'Segna come visto' : 'Rimuovi';
  });

  private seq = 0;
  private lastFolderDropAt = 0;

  constructor() {
    effect(() => {
      const kind = this.kind();
      const media = this.mediaFilter();
      const status = kind === 'watchlist' ? this.statusFilter() : undefined;
      this.auth.currentUser();
      this.watchlist.tick();
      void this.load(kind, media, status);
    });

    effect(() => {
      try { localStorage.setItem(MEDIA_FILTER_KEY, this.mediaFilter()); } catch { /* storage unavailable */ }
    });

    effect(() => {
      try { localStorage.setItem(STATUS_FILTER_KEY, this.statusFilter()); } catch { /* storage unavailable */ }
    });

    effect(() => {
      try { localStorage.setItem(EXPANDED_FOLDERS_KEY, JSON.stringify(this.expandedFolders())); } catch { /* storage unavailable */ }
    });

    effect(() => {
      if (!this.folderFeatureEnabled() && this.folderModalOpen()) {
        this.closeFolderModal();
      }
    });
  }

  protected setViewMode(mode: ViewMode): void {
    this.viewMode.set(mode);
    try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch { /* storage unavailable */ }
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
    if (Date.now() - this.lastFolderDropAt < 180) return;
    this.expandedFolders.update((state) => ({ ...state, [folderId]: !state[folderId] }));
  }

  protected folderGridMeta(group: FolderGroup): string {
    return `${folderCountLabel(group.count)} • ${folderMediaLabel(group)}`;
  }

  protected folderListMeta(group: FolderGroup): string {
    return `${folderCountLabel(group.count)} • ${folderMediaLabel(group)}`;
  }

  protected onCardClick(item: CardItem): void {
    const queryParams: Record<string, number> = {};
    if (item.season) queryParams['s'] = item.season;
    if (item.episode) queryParams['e'] = item.episode;
    void this.router.navigate(['/watch', item.media_type, item.tmdb_id], { queryParams });
  }

  protected async onRemoveClick(item: CardItem): Promise<void> {
    this.pendingAction.set({ type: 'remove-item', item });
    this.confirmModalOpen.set(true);
  }

  protected async onStatusToggle(item: CardItem): Promise<void> {
    if (this.kind() !== 'watchlist') return;
    const next: WatchlistStatus = (item.status ?? 'todo') === 'done' ? 'todo' : 'done';
    if (next === 'done') {
      this.pendingAction.set({ type: 'mark-done', item });
      this.confirmModalOpen.set(true);
      return;
    }
    await runCardMutation(this.items, item, 'status', async () => {
      await this.watchlist.setStatus(item.tmdb_id, item.media_type, next);
      this.items.update(items => items.map(candidate => (
        candidate.tmdb_id === item.tmdb_id && candidate.media_type === item.media_type
          ? { ...candidate, status: next }
          : candidate
      )));
      this.toast.show(`${item.title}: rimesso in "Da guardare"`);
      void this.load(this.kind(), this.mediaFilter(), this.statusFilter());
    });
  }

  protected async onWatchlistToggle(item: CardItem): Promise<void> {
    if (this.kind() !== 'history' || !this.auth.isLoggedIn()) return;
    if (item.inWatchlist) {
      this.pendingAction.set({ type: 'remove-watchlist', item });
      this.confirmModalOpen.set(true);
      return;
    }
    await runCardMutation(this.items, item, 'watchlist', async () => {
      const result = await toggleCardWatchlist(item, this.watchlist);
      this.items.update((items) => setCardWatchlistFlag(items, item, result.inWatchlist));
      this.toast.show(result.message);
    });
  }

  protected openFolderModal(item: CardItem): void {
    if (!this.folderFeatureEnabled()) return;
    this.folderTargetItem.set(item);
    this.folderDraft.set(item.folderName ?? '');
    this.folderModalOpen.set(true);
  }

  protected closeFolderModal(): void {
    this.folderModalOpen.set(false);
    this.folderTargetItem.set(null);
    this.folderDraft.set('');
    this.savingFolder.set(false);
  }

  protected onFolderDraftInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    this.folderDraft.set(target.value);
  }

  protected selectFolder(folderName: string): void {
    this.folderDraft.set(folderName);
  }

  protected async saveFolder(): Promise<void> {
    const item = this.folderTargetItem();
    const folderName = normalizeFolderName(this.folderDraft());
    if (!item || folderName === null) return;

    this.savingFolder.set(true);
    try {
      await this.applyFolderChange(item, folderName, `${item.title}: spostato in ${folderName}`, true);
    } finally {
      if (this.folderModalOpen()) this.savingFolder.set(false);
    }
  }

  protected async removeFolder(): Promise<void> {
    const item = this.folderTargetItem();
    if (!item || !item.folderName) return;

    this.savingFolder.set(true);
    try {
      await this.applyFolderChange(item, null, `${item.title}: folder rimosso`, true);
    } finally {
      if (this.folderModalOpen()) this.savingFolder.set(false);
    }
  }

  protected canDragItem(item: CardItem | null): boolean {
    return !!item && (this.kind() === 'watchlist' || this.kind() === 'history') && !item.pendingAction;
  }

  protected isDraggingItem(item: CardItem | null): boolean {
    const dragged = this.draggedItem();
    return !!item && !!dragged && item.tmdb_id === dragged.tmdb_id && item.media_type === dragged.media_type;
  }

  protected isFolderDropActive(folderId: string): boolean {
    return this.dropFolderId() === folderId;
  }

  protected onItemDragStart(event: DragEvent, item: CardItem): void {
    if (!this.canDragItem(item)) {
      event.preventDefault();
      return;
    }
    this.draggedItem.set(item);
    this.dropFolderId.set(null);
    this.dropRemoveActive.set(false);
    event.dataTransfer?.setData('text/plain', cardKey(item));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  protected onItemDragEnd(): void {
    this.draggedItem.set(null);
    this.dropFolderId.set(null);
    this.dropRemoveActive.set(false);
  }

  protected onFolderDragOver(event: DragEvent, group: FolderGroup): void {
    if (!this.canDropIntoFolder(group)) return;
    event.preventDefault();
    this.dropFolderId.set(group.id);
    this.dropRemoveActive.set(false);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  protected onFolderDragLeave(folderId: string): void {
    if (this.dropFolderId() === folderId) {
      this.dropFolderId.set(null);
    }
  }

  protected onFolderDrop(event: DragEvent, group: FolderGroup): void {
    if (!this.canDropIntoFolder(group)) return;
    event.preventDefault();
    event.stopPropagation();
    const item = this.draggedItem();
    this.lastFolderDropAt = Date.now();
    this.dropFolderId.set(null);
    if (!item) return;
    void this.applyFolderChange(item, group.name, `${item.title}: spostato in ${group.name}`);
    this.onItemDragEnd();
  }

  protected onRemoveDragOver(event: DragEvent): void {
    if (!this.draggedItem()) return;
    event.preventDefault();
    this.dropFolderId.set(null);
    this.dropRemoveActive.set(true);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  protected onRemoveDragLeave(): void {
    this.dropRemoveActive.set(false);
  }

  protected onRemoveDrop(event: DragEvent): void {
    const item = this.draggedItem();
    if (!item) return;
    event.preventDefault();
    event.stopPropagation();
    this.dropRemoveActive.set(false);
    void this.removeItemImmediately(item);
    this.onItemDragEnd();
  }

  protected async confirmPendingAction(): Promise<void> {
    const action = this.pendingAction();
    this.pendingAction.set(null);
    if (!action) return;

    if (action.type === 'mark-done') {
      await runCardMutation(this.items, action.item, 'status', async () => {
        await this.watchlist.setStatus(action.item.tmdb_id, action.item.media_type, 'done');
        this.toast.show(`${action.item.title}: segnato come visto`);
        void this.load(this.kind(), this.mediaFilter(), this.statusFilter());
      });
      return;
    }

    if (action.type === 'remove-watchlist') {
      await runCardMutation(this.items, action.item, 'watchlist', async () => {
        await this.watchlist.remove(action.item.tmdb_id, action.item.media_type);
        this.items.update((items) => setCardWatchlistFlag(items, action.item, false));
        this.toast.show(`${action.item.title}: rimosso dalla lista`);
      });
      return;
    }

    const item = action.item;
    await runCardMutation(this.items, item, 'remove', async () => {
      if (this.kind() === 'watchlist') {
        await this.watchlist.remove(item.tmdb_id, item.media_type);
        this.toast.show(`${item.title}: rimosso dalla lista`);
      } else {
        await this.history.remove(item.tmdb_id, item.media_type);
        this.toast.show(`${item.title}: rimosso dalla cronologia`);
      }
      this.items.update(arr => arr.filter(i => !(i.tmdb_id === item.tmdb_id && i.media_type === item.media_type)));
    });
  }

  protected cancelPendingAction(): void {
    this.pendingAction.set(null);
  }

  private canDropIntoFolder(group: FolderGroup): boolean {
    const item = this.draggedItem();
    return !!item
      && this.kind() === 'watchlist'
      && this.folderFeatureEnabled()
      && !item.pendingAction
      && normalizeFolderName(item.folderName) !== group.name;
  }

  private async applyFolderChange(
    item: CardItem,
    folderName: string | null,
    successMessage: string,
    closeModal = false
  ): Promise<void> {
    await runCardMutation(this.items, item, 'folder', async () => {
      await this.watchlist.setFolder(item.tmdb_id, item.media_type, folderName);
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
        this.closeFolderModal();
      }
    });
  }

  private async removeItemImmediately(item: CardItem): Promise<void> {
    await runCardMutation(this.items, item, 'remove', async () => {
      if (this.kind() === 'watchlist') {
        await this.watchlist.remove(item.tmdb_id, item.media_type);
        this.toast.show(`${item.title}: rimosso dalla lista`);
      } else {
        await this.history.remove(item.tmdb_id, item.media_type);
        this.toast.show(`${item.title}: rimosso dalla cronologia`);
      }
      this.items.update(arr => arr.filter(i => !(i.tmdb_id === item.tmdb_id && i.media_type === item.media_type)));
    });
  }

  private async load(kind: UserListType, media: MediaFilter, status?: WatchlistStatus): Promise<void> {
    const mySeq = ++this.seq;
    this.loading.set(true);
    this.items.set([]);
    const mediaType = media === 'all' ? undefined : media as BackendMediaFilter;
    if (kind === 'watchlist') {
      const list = await this.watchlist.list({ status, ...(mediaType ? { media_type: mediaType } : {}) });
      if (mySeq !== this.seq) return;
      const items = await enrichCardsWithTmdb(list.map(w => ({
        tmdb_id: w.tmdb_id,
        media_type: w.media_type,
        title: w.title ?? 'Senza titolo',
        poster: w.poster,
        status: w.status ?? 'todo',
        folderName: w.folder_name ?? null,
        watchStatus: w.watch_status_text,
        season: w.resume_season,
        episode: w.resume_episode,
        position: w.position,
        duration: w.duration
      })), this.tmdb, { releaseTextMode: 'all' });
      if (mySeq !== this.seq) return;
      this.items.set(items);
    } else {
      const [list, watchlist] = await Promise.all([
        this.history.list(mediaType ? { media_type: mediaType } : undefined),
        this.watchlist.list()
      ]);
      if (mySeq !== this.seq) return;
      const items = await enrichCardsWithTmdb(applyWatchlistFlags(list.map(h => ({
        tmdb_id: h.tmdb_id,
        media_type: h.media_type,
        title: h.title ?? 'Senza titolo',
        poster: h.poster,
        season: h.season,
        episode: h.episode
      })), watchlist), this.tmdb, { releaseTextMode: 'all' });
      if (mySeq !== this.seq) return;
      this.items.set(items);
    }
    this.loading.set(false);
  }
}

function loadViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_MODE_KEY);
    return v === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

function loadMediaFilter(): MediaFilter {
  try {
    const value = localStorage.getItem(MEDIA_FILTER_KEY);
    return value === 'tv' || value === 'movie' ? value : 'all';
  } catch {
    return 'all';
  }
}

function loadStatusFilter(): WatchlistStatus {
  try {
    const value = localStorage.getItem(STATUS_FILTER_KEY);
    return value === 'done' ? 'done' : 'todo';
  } catch {
    return 'todo';
  }
}

function loadExpandedFolders(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(EXPANDED_FOLDERS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).filter(([key, value]) => typeof key === 'string' && value === true)
    ) as Record<string, boolean>;
  } catch {
    return {};
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

function normalizeFolderName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed : null;
}

function folderIdFromName(name: string): string {
  return normalizeFolderName(name)?.toLocaleLowerCase() ?? '';
}

function buildDisplayEntries(
  items: CardItem[],
  foldersEnabled: boolean,
  expandedFolders: Record<string, boolean>
): DisplayEntry[] {
  if (!foldersEnabled) {
    return items.map((item) => ({
      key: cardKey(item),
      item,
      group: null,
      expanded: false
    }));
  }

  const groups = new Map<string, FolderGroup>();
  for (const item of items) {
    const folderName = normalizeFolderName(item.folderName);
    if (!folderName) continue;

    const id = folderIdFromName(folderName);
    const existing = groups.get(id);
    if (existing) {
      existing.items.push(item);
      existing.count += 1;
      if (item.media_type === 'movie') existing.movieCount += 1;
      if (item.media_type === 'tv') existing.tvCount += 1;
      continue;
    }

    groups.set(id, {
      id,
      name: folderName,
      items: [item],
      count: 1,
      movieCount: item.media_type === 'movie' ? 1 : 0,
      tvCount: item.media_type === 'tv' ? 1 : 0
    });
  }

  const emitted = new Set<string>();
  const entries: DisplayEntry[] = [];
  for (const item of items) {
    const folderName = normalizeFolderName(item.folderName);
    if (!folderName) {
      entries.push({ key: cardKey(item), item, group: null, expanded: false });
      continue;
    }

    const id = folderIdFromName(folderName);
    if (emitted.has(id)) continue;
    emitted.add(id);
    const group = groups.get(id);
    if (!group) continue;
    entries.push({
      key: `folder:${id}`,
      item: null,
      group,
      expanded: expandedFolders[id] === true
    });
  }

  return entries;
}

function cardKey(item: CardItem): string {
  return `${item.media_type}:${item.tmdb_id}`;
}

function folderCountLabel(count: number): string {
  return count === 1 ? '1 titolo' : `${count} titoli`;
}

function folderMediaLabel(group: FolderGroup): string {
  if (group.movieCount > 0 && group.tvCount > 0) return 'film e serie';
  if (group.tvCount > 0) return group.tvCount === 1 ? '1 serie' : `${group.tvCount} serie`;
  return group.movieCount === 1 ? '1 film' : `${group.movieCount} film`;
}
