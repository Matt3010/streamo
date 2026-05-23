import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

@Component({
  selector: 'ui-range',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="ui-range">
      <span class="ui-range-label">{{ label() }}</span>
      <input
        type="range"
        class="ui-range-input"
        [min]="min()"
        [max]="max()"
        [step]="step()"
        [disabled]="disabled()"
        [value]="value()"
        (input)="onInput($event)" />
      <strong class="ui-range-value">{{ value() }}{{ suffix() }}</strong>
    </label>
  `,
  styleUrl: './range.component.css'
})
export class UiRangeComponent {
  readonly label = input.required<string>();
  readonly value = model.required<number>();
  readonly min = input(0);
  readonly max = input(100);
  readonly step = input(1);
  readonly suffix = input('');
  readonly disabled = input(false);

  protected onInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const next = Number(target.value);
    if (!Number.isFinite(next)) return;
    this.value.set(next);
  }
}
