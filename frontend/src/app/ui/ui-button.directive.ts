import { Directive, input } from '@angular/core';

type UiButtonVariant =
  | 'default'
  | 'primary'
  | 'danger'
  | 'danger-outline'
  | 'ghost'
  | 'back'
  | 'tab'
  | 'panel'
  | 'icon'
  | 'inline';

@Directive({
  selector: 'button[uiButton], a[uiButton]',
  standalone: true,
  host: {
    'class': 'ui-button',
    '[class.ui-button-primary]': 'variant() === "primary"',
    '[class.ui-button-danger]': 'variant() === "danger"',
    '[class.ui-button-danger-outline]': 'variant() === "danger-outline"',
    '[class.ui-button-ghost]': 'variant() === "ghost"',
    '[class.ui-button-back]': 'variant() === "back"',
    '[class.ui-button-tab]': 'variant() === "tab"',
    '[class.ui-button-panel]': 'variant() === "panel"',
    '[class.ui-button-icon]': 'variant() === "icon"',
    '[class.ui-button-inline]': 'variant() === "inline"'
  }
})
export class UiButtonDirective {
  readonly variant = input<UiButtonVariant, UiButtonVariant | '' | null | undefined>('default', {
    alias: 'uiButton',
    transform: (value) => (value && value.length > 0 ? value : 'default') as UiButtonVariant
  });
}
