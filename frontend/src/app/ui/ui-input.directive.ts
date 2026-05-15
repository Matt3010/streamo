import { Directive, input } from '@angular/core';

type UiInputVariant = 'default' | 'compact' | 'dense';

@Directive({
  selector: 'input[uiInput], select[uiInput], textarea[uiInput]',
  standalone: true,
  host: {
    'class': 'ui-input',
    '[class.ui-input-compact]': 'variant() === "compact"',
    '[class.ui-input-dense]': 'variant() === "dense"'
  }
})
export class UiInputDirective {
  readonly variant = input<UiInputVariant, UiInputVariant | '' | null | undefined>('default', {
    alias: 'uiInput',
    transform: (value) => (value && value.length > 0 ? value : 'default') as UiInputVariant
  });
}
