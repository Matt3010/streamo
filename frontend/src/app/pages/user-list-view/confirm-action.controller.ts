import { computed, signal, type Signal } from '@angular/core';
import type { CardItem } from '../../models';
import type { UserListType } from './user-list-view.component';

export type PendingAction =
  | { type: 'remove-item'; item: CardItem }
  | { type: 'mark-done'; item: CardItem }
  | { type: 'remove-watchlist'; item: CardItem };

/* Owns the pending-action signal that drives the confirm modal in
 * user-list-view, plus the modal copy (title / message / warning /
 * action label). Keeping this small piece of state isolated lets the
 * component template bind to a single controller instance instead of
 * five separate signals. */
export class ConfirmActionController {
  readonly open = signal(false);
  readonly pending = signal<PendingAction | null>(null);

  readonly title = computed(() => {
    const action = this.pending();
    if (!action) return 'Conferma';
    if (action.type === 'mark-done') return 'Segna Come Visto';
    if (action.type === 'remove-watchlist') return 'Rimuovi Dalla Lista';
    return this.kind() === 'watchlist' ? 'Rimuovi Dalla Lista' : 'Rimuovi Dalla Cronologia';
  });

  readonly message = computed(() => {
    const action = this.pending();
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

  readonly warning = computed(() => {
    const action = this.pending();
    if (!action) return '';
    if (action.type === 'mark-done') return 'Il titolo verrà spostato nella sezione "Visto".';
    if (action.type === 'remove-watchlist') return 'Potrai sempre riaggiungerlo più tardi.';
    return this.kind() === 'watchlist'
      ? 'Potrai sempre riaggiungerlo più tardi.'
      : 'Questa voce sparirà dalla cronologia.';
  });

  readonly actionLabel = computed(() => {
    const action = this.pending();
    if (!action) return 'Conferma';
    if (action.type === 'mark-done') return 'Segna come visto';
    return 'Rimuovi';
  });

  constructor(private readonly kind: Signal<UserListType>) {}

  request(action: PendingAction): void {
    this.pending.set(action);
    this.open.set(true);
  }

  cancel(): void {
    this.pending.set(null);
  }

  /** Read and clear the pending action. The component handles the
   * actual mutation against its services. */
  consume(): PendingAction | null {
    const action = this.pending();
    this.pending.set(null);
    return action;
  }
}
