import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { UiButtonDirective } from '../ui-button.directive';

@Component({
  selector: 'ui-back-button',
  standalone: true,
  imports: [IconComponent, UiButtonDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button uiButton="back" [attr.aria-label]="label()" (click)="pressed.emit()">
      <app-icon name="chevron-left"></app-icon>
      <span>{{ label() }}</span>
    </button>
  `
})
export class BackButtonComponent {
  readonly label = input('Indietro');

  readonly pressed = output<void>();
}
