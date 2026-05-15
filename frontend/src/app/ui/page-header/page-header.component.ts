import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { BackButtonComponent } from '../back-button/back-button.component';

@Component({
  selector: 'app-page-header',
  standalone: true,
  imports: [BackButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      @if (showBack()) {
        <div class="page-header-back">
          <ui-back-button (pressed)="back.emit()" />
        </div>
      }
      <div class="page-header-row">
        <h2>{{ title() }}</h2>
        <div class="page-actions">
          <ng-content></ng-content>
        </div>
      </div>
    </div>
  `
})
export class PageHeaderComponent {
  readonly title = input.required<string>();
  readonly showBack = input(true);

  readonly back = output<void>();
}
