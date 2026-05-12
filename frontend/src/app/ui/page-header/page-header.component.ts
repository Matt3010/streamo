import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'ui-page-header',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div class="page-header-back">
        <button class="back-btn" [attr.aria-label]="backLabel()" (click)="backClick.emit()">
          <app-icon name="chevron-left"></app-icon>
          <span>{{ backLabel() }}</span>
        </button>
      </div>
      <div class="page-header-row">
        <h2>{{ title() }}</h2>
        <ng-content select="[headerActions]"></ng-content>
      </div>
    </div>
  `
})
export class PageHeaderComponent {
  readonly title = input.required<string>();
  readonly backLabel = input('Indietro');

  readonly backClick = output<void>();
}
