import { signal, type Signal } from '@angular/core';
import type { CardItem } from '../../models';
import type { FolderGroup } from './folder.model';
import { cardKey, normalizeFolderName } from './folder-entries.util';
import type { UserListType } from './user-list-view.component';

export interface DragDropContext {
  readonly kind: Signal<UserListType>;
  readonly enabled: Signal<boolean>;
  /** Move the dragged item into the target folder. The component owns
   * the watchlist write; this just delegates with the desired name. */
  applyFolderChange(item: CardItem, folderName: string, successMessage: string): Promise<void>;
}

/* Encapsulates drag-and-drop state and event handlers for moving an
 * item into a folder card/row. Also tracks the most recent drop
 * timestamp so the parent can debounce the folder toggle click that
 * fires immediately after a drop. */
export class DragDropController {
  readonly draggedItem = signal<CardItem | null>(null);
  readonly dropFolderId = signal<string | null>(null);
  private lastDropAt = 0;

  constructor(private readonly ctx: DragDropContext) {}

  canDragItem(item: CardItem | null): boolean {
    return !!item
      && this.ctx.kind() === 'watchlist'
      && this.ctx.enabled()
      && !item.pendingAction;
  }

  isDraggingItem(item: CardItem | null): boolean {
    const dragged = this.draggedItem();
    return !!item && !!dragged
      && item.tmdb_id === dragged.tmdb_id
      && item.media_type === dragged.media_type;
  }

  isFolderDropActive(folderId: string): boolean {
    return this.dropFolderId() === folderId;
  }

  /** True for a brief window after a drop, so the immediately-following
   * folder toggle click can be suppressed by the parent. */
  recentlyDropped(): boolean {
    return Date.now() - this.lastDropAt < 180;
  }

  onItemDragStart(event: DragEvent, item: CardItem): void {
    if (!this.canDragItem(item)) {
      event.preventDefault();
      return;
    }
    this.draggedItem.set(item);
    this.dropFolderId.set(null);
    event.dataTransfer?.setData('text/plain', cardKey(item));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onItemDragEnd(): void {
    this.draggedItem.set(null);
    this.dropFolderId.set(null);
  }

  onFolderDragOver(event: DragEvent, group: FolderGroup): void {
    if (!this.canDropIntoFolder(group)) return;
    event.preventDefault();
    this.dropFolderId.set(group.id);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onFolderDragLeave(folderId: string): void {
    if (this.dropFolderId() === folderId) {
      this.dropFolderId.set(null);
    }
  }

  onFolderDrop(event: DragEvent, group: FolderGroup): void {
    if (!this.canDropIntoFolder(group)) return;
    event.preventDefault();
    event.stopPropagation();
    const item = this.draggedItem();
    this.lastDropAt = Date.now();
    this.dropFolderId.set(null);
    if (!item) return;
    void this.ctx.applyFolderChange(item, group.name, `${item.title}: spostato in ${group.name}`);
    this.onItemDragEnd();
  }

  private canDropIntoFolder(group: FolderGroup): boolean {
    const item = this.draggedItem();
    return !!item
      && this.ctx.kind() === 'watchlist'
      && this.ctx.enabled()
      && !item.pendingAction
      && normalizeFolderName(item.folderName) !== group.name;
  }
}
