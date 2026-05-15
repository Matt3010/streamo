import { computed, signal, type Signal } from '@angular/core';
import type { CardItem } from '../../models';
import type { CardFolderClickEvent } from '../../components/card/card.component';
import { normalizeFolderName } from './folder-entries.util';

export interface FolderPopoverContext {
  /** True when the folder feature is enabled for the current view. */
  readonly enabled: Signal<boolean>;
  /** Apply a folder rename / removal on the underlying item. The
   * controller forwards the user's input here; the component owns the
   * actual write to the watchlist service. */
  applyFolderChange(
    item: CardItem,
    folderName: string | null,
    successMessage: string,
    closeModal?: boolean
  ): Promise<void>;
}

/* Encapsulates the folder-popover state and behaviour: open / close,
 * target item, draft label, save/remove handlers. The component still
 * renders the popover and owns the watchlist mutation; this class
 * keeps the related signals and small handlers off the component
 * surface. */
export class FolderPopoverController {
  readonly open = signal(false);
  readonly anchor = signal<HTMLElement | null>(null);
  readonly targetItem = signal<CardItem | null>(null);
  readonly draft = signal('');
  readonly saving = signal(false);

  readonly canSave = computed(() => {
    const target = this.targetItem();
    if (!target) return false;
    const nextFolder = normalizeFolderName(this.draft());
    return nextFolder !== null && nextFolder !== normalizeFolderName(target.folderName ?? null);
  });

  readonly targetHasFolder = computed(() => (
    normalizeFolderName(this.targetItem()?.folderName ?? null) !== null
  ));

  constructor(private readonly ctx: FolderPopoverContext) {}

  openFromCardEvent(event: CardFolderClickEvent): void {
    this.openWithAnchor(event.item, event.anchor);
  }

  openFromButton(item: CardItem, event: MouseEvent): void {
    this.openWithAnchor(
      item,
      event.currentTarget instanceof HTMLElement ? event.currentTarget : null
    );
  }

  close(): void {
    this.open.set(false);
    this.anchor.set(null);
    this.targetItem.set(null);
    this.draft.set('');
    this.saving.set(false);
  }

  onDraftInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    this.draft.set(target.value);
  }

  async save(): Promise<void> {
    const item = this.targetItem();
    const folderName = normalizeFolderName(this.draft());
    if (!item || folderName === null) return;

    this.saving.set(true);
    try {
      await this.ctx.applyFolderChange(item, folderName, `${item.title}: spostato in ${folderName}`, true);
    } finally {
      if (this.open()) this.saving.set(false);
    }
  }

  async remove(): Promise<void> {
    const item = this.targetItem();
    if (!item || !item.folderName) return;

    this.saving.set(true);
    try {
      await this.ctx.applyFolderChange(item, null, `${item.title}: folder rimosso`, true);
    } finally {
      if (this.open()) this.saving.set(false);
    }
  }

  private openWithAnchor(item: CardItem, anchor: HTMLElement | null): void {
    if (!this.ctx.enabled() || !anchor) return;
    const current = this.targetItem();
    if (this.open()
      && current
      && current.tmdb_id === item.tmdb_id
      && current.media_type === item.media_type
      && this.anchor() === anchor) {
      this.close();
      return;
    }
    this.targetItem.set(item);
    this.draft.set(item.folderName ?? '');
    this.anchor.set(anchor);
    this.open.set(true);
  }
}
