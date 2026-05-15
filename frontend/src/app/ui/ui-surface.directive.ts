import { Directive, input } from '@angular/core';

type UiSurfaceVariant = 'default' | 'row' | 'card';

@Directive({
  selector: 'button[uiSurface], a[uiSurface]',
  standalone: true,
  host: {
    'class': 'ui-surface',
    '[class.ui-surface-row]': 'variant() === "row"',
    '[class.ui-surface-card]': 'variant() === "card"'
  }
})
export class UiSurfaceDirective {
  readonly variant = input<UiSurfaceVariant, UiSurfaceVariant | '' | null | undefined>('default', {
    alias: 'uiSurface',
    transform: (value) => (value && value.length > 0 ? value : 'default') as UiSurfaceVariant
  });
}
