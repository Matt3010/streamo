import { Directive, input } from '@angular/core';

@Directive({
  selector: 'button[uiPending]',
  standalone: true,
  host: {
    '[attr.disabled]': 'uiPending() ? "" : null',
    '[class.ui-pending]': 'uiPending()',
    '[attr.aria-busy]': 'uiPending() ? "true" : null'
  }
})
export class PendingButtonDirective {
  readonly uiPending = input(false);
}
