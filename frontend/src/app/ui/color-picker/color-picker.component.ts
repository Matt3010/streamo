import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

@Component({
  selector: 'ui-color-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="ui-color-picker">
      <span class="ui-color-picker-label">{{ label() }}</span>
      <input
        type="color"
        class="ui-color-picker-input"
        [disabled]="disabled()"
        [value]="value()"
        (input)="onInput($event)" />
    </label>
  `,
  styleUrl: './color-picker.component.css'
})
export class UiColorPickerComponent {
  readonly label = input.required<string>();
  readonly value = model.required<string>();
  readonly disabled = input(false);

  protected onInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    this.value.set(target.value);
  }
}
