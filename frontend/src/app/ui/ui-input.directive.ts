import { Directive, input } from '@angular/core';

type UiInputVariant = 'default' | 'compact';

@Directive({
  selector: 'input[uiInput], select[uiInput], textarea[uiInput]',
  standalone: true,
  host: {
    'class': 'ui-input',
    '[class.ui-input-compact]': 'variant() === "compact"'
  }
})
export class UiInputDirective {
  readonly variant = input<UiInputVariant, UiInputVariant | '' | null | undefined>('default', {
    alias: 'uiInput',
    transform: (value) => (value && value.length > 0 ? value : 'default') as UiInputVariant
  });
}
