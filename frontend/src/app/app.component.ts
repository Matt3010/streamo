import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthModalComponent } from './components/auth-modal/auth-modal.component';
import { ToastComponent } from './components/toast/toast.component';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, AuthModalComponent, ToastComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <router-outlet />
    <app-auth-modal />
    <app-toast />
  `
})
export class AppComponent {
  private readonly auth = inject(AuthService);

  constructor() {
    void this.auth.checkAuth();
  }
}
