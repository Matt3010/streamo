import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (toast.message(); as msg) {
      <div class="toast">{{ msg }}</div>
    }
  `,
  styleUrl: './toast.component.css'
})
export class ToastComponent {
  protected readonly toast = inject(ToastService);
}
