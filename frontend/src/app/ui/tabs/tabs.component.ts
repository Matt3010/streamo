import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { UiButtonDirective } from '../ui-button.directive';

export interface UiTab<T extends string = string> {
  readonly value: T;
  readonly label: string;
}

@Component({
  selector: 'ui-tabs',
  standalone: true,
  imports: [UiButtonDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'role': 'tablist' },
  template: `
    @for (tab of tabs(); track tab.value) {
      <button
        uiButton="tab"
        type="button"
        role="tab"
        [class.active]="tab.value === value()"
        [attr.aria-selected]="tab.value === value()"
        (click)="select(tab.value)">
        {{ tab.label }}
      </button>
    }
  `,
  styleUrl: './tabs.component.css'
})
export class UiTabsComponent<T extends string = string> {
  readonly tabs = input.required<ReadonlyArray<UiTab<T>>>();
  readonly value = model.required<T>();

  protected select(v: T): void {
    if (v !== this.value()) this.value.set(v);
  }
}
