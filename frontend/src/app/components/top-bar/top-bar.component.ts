import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AccountMenuComponent } from '../account-menu/account-menu.component';
import { UiButtonDirective } from '../../ui/ui-button.directive';
import { AuthService } from '../../services/auth.service';
import { AuthModalService } from '../../services/auth-modal.service';

@Component({
  selector: 'app-top-bar',
  standalone: true,
  imports: [AccountMenuComponent, UiButtonDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="top-bar">
      <div class="account-area">
        @if (auth.isLoggedIn()) {
          <app-account-menu />
        } @else {
          <button uiButton="panel" (click)="authModal.open()">Accedi</button>
        }
      </div>
    </div>
  `,
  styleUrl: './top-bar.component.css'
})
export class TopBarComponent {
  protected readonly auth = inject(AuthService);
  protected readonly authModal = inject(AuthModalService);
}
