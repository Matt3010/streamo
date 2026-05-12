import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'ui-back-button',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button class="back-btn" [attr.aria-label]="label()" (click)="pressed.emit()">
      <app-icon name="chevron-left"></app-icon>
      <span>{{ label() }}</span>
    </button>
  `
})
export class BackButtonComponent {
  readonly label = input('Indietro');

  readonly pressed = output<void>();
}
