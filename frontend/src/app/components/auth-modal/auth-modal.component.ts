import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { UiModalComponent } from '../../ui/modal/modal.component';
import { AuthService } from '../../services/auth.service';
import { AuthModalService } from '../../services/auth-modal.service';
import { ToastService } from '../../services/toast.service';

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: 'Compila tutti i campi',
  invalid_email: 'Email non valida',
  weak_password: 'Password troppo corta (min 6 caratteri)',
  email_taken: 'Email gia registrata',
  invalid_credentials: 'Credenziali non valide',
  too_many_attempts: 'Troppi tentativi, riprova piu tardi',
  network_error: 'Errore di connessione'
};

@Component({
  selector: 'app-auth-modal',
  standalone: true,
  imports: [UiModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-modal [(open)]="modalState.visible"
              [title]="isLogin() ? 'Accedi' : 'Registrati'"
              size="sm"
              (closed)="resetForm()">
      <form class="auth-form" (submit)="submit($event)">
        <label>
          <span>Email</span>
          <input type="email" autocomplete="email" maxlength="254" required
                 [value]="email()" (input)="updateEmail($event)">
        </label>
        <label>
          <span>Password</span>
          <input type="password" autocomplete="current-password" minlength="6" required
                 [value]="password()" (input)="updatePassword($event)">
        </label>
        @if (errorMsg()) { <p class="auth-error">{{ errorMsg() }}</p> }
        <button type="submit" class="primary-btn" [disabled]="submitting()">
          {{ isLogin() ? 'Accedi' : 'Registrati' }}
        </button>
        <p class="auth-toggle">
          <span>{{ isLogin() ? 'Non hai un account?' : 'Hai gia un account?' }}</span>
          <a href="#" (click)="toggleMode($event)">{{ isLogin() ? 'Registrati' : 'Accedi' }}</a>
        </p>
      </form>
    </ui-modal>
  `,
  styleUrl: './auth-modal.component.css'
})
export class AuthModalComponent {
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  protected readonly modalState = inject(AuthModalService);

  protected readonly isLogin = signal(true);
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly errorCode = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly errorMsg = computed(() => {
    const code = this.errorCode();
    if (!code) return '';
    return ERROR_MESSAGES[code] ?? 'Errore sconosciuto';
  });

  protected resetForm(): void {
    this.errorCode.set(null);
    this.email.set('');
    this.password.set('');
  }

  protected toggleMode(ev: Event): void {
    ev.preventDefault();
    this.isLogin.update(v => !v);
    this.errorCode.set(null);
  }

  protected updateEmail(ev: Event): void {
    const t = ev.target;
    if (t instanceof HTMLInputElement) this.email.set(t.value);
  }
  protected updatePassword(ev: Event): void {
    const t = ev.target;
    if (t instanceof HTMLInputElement) this.password.set(t.value);
  }

  protected async submit(ev: Event): Promise<void> {
    ev.preventDefault();
    this.errorCode.set(null);
    this.submitting.set(true);
    try {
      const fn = this.isLogin() ? this.auth.login.bind(this.auth) : this.auth.register.bind(this.auth);
      const res = await fn(this.email().trim(), this.password());
      if (res.user) {
        this.toast.show(`Benvenuto, ${res.user.email}!`);
        this.modalState.visible.set(false);
        this.resetForm();
      } else {
        this.errorCode.set(res.error ?? 'unknown');
      }
    } finally {
      this.submitting.set(false);
    }
  }
}
