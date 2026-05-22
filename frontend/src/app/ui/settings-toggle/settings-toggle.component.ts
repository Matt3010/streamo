import { ChangeDetectionStrategy, Component, HostBinding, input, output } from '@angular/core';

@Component({
  selector: 'ui-settings-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="setting-row">
      <div class="setting-copy">
        <h3>{{ title() }}</h3>
        <p>{{ description() }}</p>
      </div>
      <label class="setting-switch">
        <input type="checkbox" [checked]="checked()" [disabled]="disabled()" (change)="changed.emit($event)">
        <span></span>
      </label>
    </div>
  `,
  styleUrl: './settings-toggle.component.css'
})
export class SettingsToggleComponent {
  readonly title = input.required<string>();
  readonly description = input.required<string>();
  readonly checked = input(false);
  readonly disabled = input(false);

  readonly changed = output<Event>();

  // Suppress the native HTML title attribute on the host. Angular forwards
  // `title="…"` from the parent template both as the input AND as a DOM
  // attribute on the host element — the latter triggers the browser's
  // built-in tooltip on hover, which looks like a stray label.
  @HostBinding('attr.title') readonly hostTitleAttr: string | null = null;
}
