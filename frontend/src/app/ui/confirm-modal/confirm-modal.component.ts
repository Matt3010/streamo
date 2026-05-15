import { ChangeDetectionStrategy, Component, input, model, output } from '@angular/core';
import { UiModalComponent } from '../modal/modal.component';
import { UiButtonDirective } from '../ui-button.directive';

@Component({
  selector: 'ui-confirm-modal',
  standalone: true,
  imports: [UiModalComponent, UiButtonDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-modal [(open)]="open" [title]="title()" size="sm" (closed)="cancel()">
      <div class="confirm-modal-content">
        <p>{{ message() }}</p>
        @if (warning()) {
          <p class="warning">{{ warning() }}</p>
        }
        <div class="modal-actions">
          <button uiButton="ghost" type="button" (click)="cancel()">{{ cancelLabel() }}</button>
          <button uiButton="danger" type="button" (click)="confirm()">{{ actionLabel() }}</button>
        </div>
      </div>
    </ui-modal>
  `,
  styleUrl: './confirm-modal.component.css'
})
export class ConfirmModalComponent {
  readonly open = model.required<boolean>();
  readonly title = input.required<string>();
  readonly message = input.required<string>();
  readonly warning = input('');
  readonly actionLabel = input('Conferma');
  readonly cancelLabel = input('Annulla');

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  protected cancel(): void {
    this.open.set(false);
    this.cancelled.emit();
  }

  protected confirm(): void {
    this.open.set(false);
    this.confirmed.emit();
  }
}
