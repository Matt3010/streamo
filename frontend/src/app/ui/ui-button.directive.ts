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
  | 'panel-pill'
  | 'icon'
  | 'icon-circle'
  | 'icon-outline'
  | 'icon-subtle'
  | 'icon-overlay'
  | 'menu-item'
  | 'toggle-icon'
  | 'inline';

type UiButtonTone = 'default' | 'accent' | 'neutral' | 'success' | 'info' | 'danger';
type UiButtonHover = 'default' | 'accent' | 'danger' | 'success' | 'neutral';

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
    '[class.ui-button-panel-pill]': 'variant() === "panel-pill"',
    '[class.ui-button-icon]': 'variant() === "icon"',
    '[class.ui-button-icon-circle]': 'variant() === "icon-circle"',
    '[class.ui-button-icon-outline]': 'variant() === "icon-outline"',
    '[class.ui-button-icon-subtle]': 'variant() === "icon-subtle"',
    '[class.ui-button-icon-overlay]': 'variant() === "icon-overlay"',
    '[class.ui-button-menu-item]': 'variant() === "menu-item"',
    '[class.ui-button-toggle-icon]': 'variant() === "toggle-icon"',
    '[class.ui-button-inline]': 'variant() === "inline"',
    '[class.ui-button-tone-accent]': 'tone() === "accent"',
    '[class.ui-button-tone-neutral]': 'tone() === "neutral"',
    '[class.ui-button-tone-success]': 'tone() === "success"',
    '[class.ui-button-tone-info]': 'tone() === "info"',
    '[class.ui-button-tone-danger]': 'tone() === "danger"',
    '[class.ui-button-hover-accent]': 'hover() === "accent"',
    '[class.ui-button-hover-danger]': 'hover() === "danger"',
    '[class.ui-button-hover-success]': 'hover() === "success"',
    '[class.ui-button-hover-neutral]': 'hover() === "neutral"'
  }
})
export class UiButtonDirective {
  readonly variant = input<UiButtonVariant, UiButtonVariant | '' | null | undefined>('default', {
    alias: 'uiButton',
    transform: (value) => (value && value.length > 0 ? value : 'default') as UiButtonVariant
  });

  readonly tone = input<UiButtonTone, UiButtonTone | '' | null | undefined>('default', {
    alias: 'uiButtonTone',
    transform: (value) => (value && value.length > 0 ? value : 'default') as UiButtonTone
  });

  readonly hover = input<UiButtonHover, UiButtonHover | '' | null | undefined>('default', {
    alias: 'uiButtonHover',
    transform: (value) => (value && value.length > 0 ? value : 'default') as UiButtonHover
  });
}
